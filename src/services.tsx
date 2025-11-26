
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import React from 'react';
import { PROMPT_TEMPLATES } from './prompts';
import { AI_MODELS, IMGUR_CLIENT_ID, CACHE_TTL, TARGET_MIN_WORDS, TARGET_MAX_WORDS } from './constants';
import {
    ApiClients, ContentItem, ExpandedGeoTargeting, GeneratedContent, GenerationContext, SiteInfo, SitemapPage, WpConfig, GapAnalysisSuggestion
} from './types';
import {
    apiCache,
    callAiWithRetry,
    extractSlugFromUrl,
    fetchWordPressWithRetry,
    processConcurrently,
    parseJsonWithAiRepair,
    persistentCache,
    lazySchemaGeneration,
    resolveFinalUrl,
    validateAndFixUrl
} from './utils';
import { generateFullSchema, generateSchemaMarkup } from "./schema-generator";
import { getNeuronWriterAnalysis, formatNeuronDataForPrompt } from "./neuronwriter";
import { getGuaranteedYoutubeVideos, enforceWordCount, ContentTooShortError, ContentTooLongError, normalizeGeneratedContent, postProcessGeneratedHtml, performSurgicalUpdate, processInternalLinks, fetchWithProxies, smartCrawl, escapeRegExp } from "./contentUtils";
import { Buffer } from 'buffer';

class SotaAIError extends Error {
  constructor(
    public code: 'INVALID_PARAMS' | 'EMPTY_RESPONSE' | 'RATE_LIMIT' | 'AUTH_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'SotaAIError';
  }
}

// SOTA: News Fetcher for "Living Content"
const fetchRecentNews = async (keyword: string, serperApiKey: string) => {
    if (!serperApiKey) return null;
    try {
        const response = await fetchWithProxies("https://google.serper.dev/news", {
            method: 'POST',
            headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: keyword, tbs: "qdr:m", num: 3 }) // qdr:m = last month
        });
        const data = await response.json();
        if (data.news && data.news.length > 0) {
            return data.news.map((n: any) => `- ${n.title} (${n.source}) - ${n.date}`).join('\n');
        }
        return null;
    } catch (e) {
        console.warn("News fetch failed", e);
        return null;
    }
};

// SOTA: PAA Fetcher for FAQ Generation
const fetchPAA = async (keyword: string, serperApiKey: string) => {
    if (!serperApiKey) return null;
    try {
        const response = await fetchWithProxies("https://google.serper.dev/search", {
            method: 'POST',
            headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: keyword, type: 'search' }) 
        });
        const data = await response.json();
        if (data.peopleAlsoAsk && Array.isArray(data.peopleAlsoAsk)) {
            // SOTA REQUIREMENT: Top 6 FAQs for maximum SERP real estate
            return data.peopleAlsoAsk.map((item: any) => item.question).slice(0, 6);
        }
        return null;
    } catch (e) {
        console.warn("PAA fetch failed", e);
        return null;
    }
};

const _internalCallAI = async (
    apiClients: ApiClients,
    selectedModel: string,
    geoTargeting: ExpandedGeoTargeting,
    openrouterModels: string[],
    selectedGroqModel: string,
    promptKey: keyof typeof PROMPT_TEMPLATES,
    promptArgs: any[],
    responseFormat: 'json' | 'html' = 'json',
    useGrounding: boolean = false
): Promise<string> => {
    if (!apiClients) throw new SotaAIError('INVALID_PARAMS', 'API clients object is undefined.');
    const client = apiClients[selectedModel as keyof typeof apiClients];
    if (!client) throw new SotaAIError('AUTH_FAILED', `API Client for '${selectedModel}' not initialized.`);

    const cacheKey = `${String(promptKey)}-${JSON.stringify(promptArgs)}`;
    const cached = apiCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    
    const template = PROMPT_TEMPLATES[promptKey];
    // @ts-ignore
    const systemInstruction = (promptKey === 'cluster_planner' && typeof template.systemInstruction === 'string') 
        ? template.systemInstruction.replace('{{GEO_TARGET_INSTRUCTIONS}}', (geoTargeting.enabled && geoTargeting.location) ? `All titles must be geo-targeted for "${geoTargeting.location}".` : '')
        : template.systemInstruction;
    // @ts-ignore
    const userPrompt = template.userPrompt(...promptArgs);
    
    let responseText: string | null = '';

    switch (selectedModel) {
        case 'gemini':
             const geminiConfig: { systemInstruction: string; responseMimeType?: string; tools?: any[] } = { systemInstruction };
            if (responseFormat === 'json') geminiConfig.responseMimeType = "application/json";
             if (useGrounding) {
                geminiConfig.tools = [{googleSearch: {}}];
                if (geminiConfig.responseMimeType) delete geminiConfig.responseMimeType;
            }
            const geminiResponse = await callAiWithRetry(() => (client as GoogleGenAI).models.generateContent({
                model: AI_MODELS.GEMINI_FLASH,
                contents: userPrompt,
                config: geminiConfig,
            }));
            responseText = geminiResponse.text;
            break;
        case 'openai':
            const openaiResponse = await callAiWithRetry(() => (client as unknown as OpenAI).chat.completions.create({
                model: AI_MODELS.OPENAI_GPT4_TURBO,
                messages: [{ role: "system", content: systemInstruction }, { role: "user", content: userPrompt }],
                ...(responseFormat === 'json' && { response_format: { type: "json_object" } })
            }));
            responseText = openaiResponse.choices[0].message.content;
            break;
        case 'openrouter':
            for (const modelName of openrouterModels) {
                try {
                    const response = await callAiWithRetry(() => (client as unknown as OpenAI).chat.completions.create({
                        model: modelName,
                        messages: [{ role: "system", content: systemInstruction }, { role: "user", content: userPrompt }],
                         ...(responseFormat === 'json' && { response_format: { type: "json_object" } })
                    }));
                    responseText = response.choices[0].message.content;
                    break;
                } catch (error) { console.error(error); }
            }
            break;
        case 'groq':
             const groqResponse = await callAiWithRetry(() => (client as unknown as OpenAI).chat.completions.create({
                model: selectedGroqModel,
                messages: [{ role: "system", content: systemInstruction }, { role: "user", content: userPrompt }],
                ...(responseFormat === 'json' && { response_format: { type: "json_object" } })
            }));
            responseText = groqResponse.choices[0].message.content;
            break;
        case 'anthropic':
            const anthropicResponse = await callAiWithRetry(() => (client as unknown as Anthropic).messages.create({
                model: AI_MODELS.ANTHROPIC_OPUS,
                max_tokens: 4096,
                system: systemInstruction,
                messages: [{ role: "user", content: userPrompt }],
            }));
            responseText = anthropicResponse.content?.map(c => c.text).join("") || "";
            break;
    }

    if (!responseText) throw new Error(`AI returned empty response for '${String(promptKey)}'.`);
    apiCache.set(cacheKey, responseText);
    return responseText;
};

export const callAI = async (...args: Parameters<typeof _internalCallAI>): Promise<string> => {
    const [apiClients, selectedModel] = args;
    let client = apiClients[selectedModel as keyof typeof apiClients];
    if (!client) {
        const fallbackOrder: (keyof ApiClients)[] = ['gemini', 'openai', 'openrouter', 'anthropic', 'groq'];
        for (const fallback of fallbackOrder) {
            if (apiClients[fallback]) {
                client = apiClients[fallback];
                args[1] = fallback as any; 
                break;
            }
        }
    }
    if (!client) throw new SotaAIError('AUTH_FAILED', 'No AI client available.');
    return await _internalCallAI(...args);
};

const aiCallCache = new Map<string, Promise<any>>();
export const memoizedCallAI = async (
    apiClients: ApiClients, selectedModel: string, geoTargeting: ExpandedGeoTargeting, openrouterModels: string[],
    selectedGroqModel: string, promptKey: keyof typeof PROMPT_TEMPLATES, promptArgs: any[],
    responseFormat: 'json' | 'html' = 'json', useGrounding: boolean = false
): Promise<string> => {
    const cacheKey = `ai_${String(promptKey)}_${JSON.stringify(promptArgs)}`;
    if (aiCallCache.has(cacheKey)) return aiCallCache.get(cacheKey)!;
    const promise = callAI(apiClients, selectedModel, geoTargeting, openrouterModels, selectedGroqModel, promptKey, promptArgs, responseFormat, useGrounding);
    aiCallCache.set(cacheKey, promise);
    setTimeout(() => aiCallCache.delete(cacheKey), 300000);
    return promise;
};

export const generateImageWithFallback = async (apiClients: ApiClients, prompt: string): Promise<string | null> => {
    if (!prompt) return null;
    if (apiClients.gemini) {
        try {
             const geminiImgResponse = await callAiWithRetry(() => apiClients.gemini!.models.generateImages({ model: AI_MODELS.GEMINI_IMAGEN, prompt: prompt, config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '16:9' } }));
             return `data:image/jpeg;base64,${String(geminiImgResponse.generatedImages[0].image.imageBytes)}`;
        } catch (error) {
             try {
                const flashImageResponse = await callAiWithRetry(() => apiClients.gemini!.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [{ text: prompt }] },
                    config: { responseModalities: ['IMAGE'] },
                }));
                return `data:image/png;base64,${String(flashImageResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data)}`;
             } catch (e) { console.error(e); }
        }
    }
    return null;
};

async function attemptDirectWordPressUpload(image: any, wpConfig: WpConfig, password: string): Promise<{ url: string, id: number } | null> {
    try {
        const response = await fetchWordPressWithRetry(
            `${wpConfig.url}/wp-json/wp/v2/media`,
            {
                method: 'POST',
                headers: new Headers({
                    'Authorization': `Basic ${btoa(`${wpConfig.username}:${password}`)}`,
                    'Content-Type': 'image/jpeg',
                    'Content-Disposition': `attachment; filename="${image.title}.jpg"`
                }),
                body: Buffer.from(image.base64Data.split(',')[1], 'base64')
            }
        );
        if (response.ok) {
            const data = await response.json();
            return { url: data.source_url, id: data.id };
        }
    } catch (error) { }
    return null;
}

const processImageLayer = async (image: any, wpConfig: WpConfig, password: string): Promise<{url: string, id: number | null} | null> => {
    const directUpload = await attemptDirectWordPressUpload(image, wpConfig, password);
    if (directUpload) return directUpload;
    return null;
};

export const publishItemToWordPress = async (
    itemToPublish: ContentItem,
    currentWpPassword: string,
    status: 'publish' | 'draft',
    fetcher: typeof fetchWordPressWithRetry,
    wpConfig: WpConfig,
): Promise<{ success: boolean; message: React.ReactNode; link?: string }> => {
    try {
        const { generatedContent } = itemToPublish;
        if (!generatedContent) return { success: false, message: 'No content generated.' };

        const headers = new Headers({ 
            'Authorization': `Basic ${btoa(`${wpConfig.username}:${currentWpPassword}`)}`,
            'Content-Type': 'application/json'
        });

        let contentToPublish = generatedContent.content;
        let featuredImageId: number | null = null;
        let existingPostId: number | null = null;
        let method = 'POST';
        let apiUrl = `${wpConfig.url.replace(/\/+$/, '')}/wp-json/wp/v2/posts`;

        // 🚀 SOTA LOGIC: SURGICAL UPDATE ENGINE
        if (itemToPublish.type === 'refresh') {
            // SAFETY VALVE: If surgical snippets are missing, DO NOT PUBLISH. 
            // This prevents overwriting a live post with the "Preview" HTML div.
            if (!generatedContent.surgicalSnippets) {
                return { success: false, message: 'Refresh Failed: AI did not generate valid surgical snippets. Aborting to protect live content.' };
            }

            // 1. Advanced ID Resolution (Strict -> Redirect -> Fuzzy)
            let searchSlug = extractSlugFromUrl(itemToPublish.originalUrl || generatedContent.slug || '');
            console.log(`[SOTA Publish] Refreshing Post. Target slug: "${searchSlug}"`);

            if (!searchSlug) return { success: false, message: 'Refresh Failed: Invalid URL/Slug.' };

            // Helper: Multi-Endpoint Search
            const findPostId = async (slug: string): Promise<{id: number, type: 'posts'|'pages'} | null> => {
                try {
                    // Try Posts
                    let res = await fetcher(`${wpConfig.url}/wp-json/wp/v2/posts?slug=${slug}&_fields=id,slug&status=any`, { method: 'GET', headers });
                    let data = await res.json();
                    if (Array.isArray(data) && data.length > 0) return { id: data[0].id, type: 'posts' };
                    
                    // Try Pages
                    res = await fetcher(`${wpConfig.url}/wp-json/wp/v2/pages?slug=${slug}&_fields=id,slug&status=any`, { method: 'GET', headers });
                    data = await res.json();
                    if (Array.isArray(data) && data.length > 0) return { id: data[0].id, type: 'pages' };
                } catch(e) {}
                return null;
            };

            // ATTEMPT 1: Exact Match
            let foundRemote = await findPostId(searchSlug);

            // ATTEMPT 2: Fuzzy Search (if strict failed)
            if (!foundRemote) {
                console.log("[SOTA Publish] Exact match failed. Trying Fuzzy Search...");
                const cleanSearch = searchSlug.replace(/-/g, ' ');
                const searchRes = await fetcher(`${wpConfig.url}/wp-json/wp/v2/posts?search=${encodeURIComponent(cleanSearch)}&_fields=id,title,slug&status=any`, { method: 'GET', headers });
                const searchData = await searchRes.json();
                
                if (Array.isArray(searchData) && searchData.length > 0) {
                    // Heuristic: Match if slug is reasonably similar
                    const candidate = searchData[0];
                    if (candidate.slug.includes(searchSlug) || searchSlug.includes(candidate.slug)) {
                        foundRemote = { id: candidate.id, type: 'posts' };
                    }
                }
            }

            if (foundRemote) {
                existingPostId = foundRemote.id;
                const endpointBase = foundRemote.type;
                
                // ⚡ CRITICAL: Fetch RAW content to inject snippets safely
                const fullPostRes = await fetcher(`${wpConfig.url}/wp-json/wp/v2/${endpointBase}/${existingPostId}?context=edit`, { method: 'GET', headers });
                const fullPost = await fullPostRes.json();
                const rawDatabaseContent = fullPost.content?.raw || fullPost.content?.rendered || '';
                
                // Apply Surgical Update
                contentToPublish = performSurgicalUpdate(rawDatabaseContent, generatedContent.surgicalSnippets);
                console.log(`[SOTA Publish] Applied surgical updates to ID ${existingPostId}`);
                
                apiUrl = `${wpConfig.url.replace(/\/+$/, '')}/wp-json/wp/v2/${endpointBase}/${existingPostId}`;
            } else {
                return { success: false, message: `Could not find original post for "${searchSlug}". Check URL or permalinks.` };
            }
        } else {
            // Standard New Post Logic (Check for duplicates)
            if (generatedContent.slug) {
                const searchRes = await fetcher(`${wpConfig.url}/wp-json/wp/v2/posts?slug=${generatedContent.slug}&_fields=id&status=any`, { method: 'GET', headers });
                const searchData = await searchRes.json();
                if (Array.isArray(searchData) && searchData.length > 0) {
                    existingPostId = searchData[0].id;
                    apiUrl = `${wpConfig.url.replace(/\/+$/, '')}/wp-json/wp/v2/posts/${existingPostId}`;
                }
            }
        }

        // Image Processing Logic
        if (contentToPublish) {
             const base64ImageRegex = /<img[^>]+src="(data:image\/(?:jpeg|png|webp);base64,([^"]+))"[^>]*>/g;
             const imagesToUpload = [...contentToPublish.matchAll(base64ImageRegex)].map((match, index) => {
                return { fullImgTag: match[0], base64Data: match[1], altText: generatedContent.title, title: `${generatedContent.slug}-${index}`, index };
            });

            for (const image of imagesToUpload) {
                const uploadResult = await processImageLayer(image, wpConfig, currentWpPassword);
                if (uploadResult && uploadResult.url) {
                    contentToPublish = contentToPublish.replace(image.fullImgTag, image.fullImgTag.replace(/src="[^"]+"/, `src="${uploadResult.url}"`));
                    if (image.index === 0 && !existingPostId) featuredImageId = uploadResult.id;
                }
            }
        }

        const postData: any = {
            title: generatedContent.title,
            content: (contentToPublish || '') + generateSchemaMarkup(generatedContent.jsonLdSchema ?? {}),
            status: status, // Respect passed status
            slug: generatedContent.slug,
            meta: {
                _yoast_wpseo_title: generatedContent.title,
                _yoast_wpseo_metadesc: generatedContent.metaDescription ?? '',
            }
        };
        if (featuredImageId) postData.featured_media = featuredImageId;

        const postResponse = await fetcher(apiUrl, { method, headers, body: JSON.stringify(postData) });
        const responseData = await postResponse.json();
        
        if (!postResponse.ok) throw new Error(responseData.message || 'WP API Error');
        
        return { success: true, message: 'Published!', link: responseData.link };

    } catch (error: any) {
        return { success: false, message: `Error: ${error.message}` };
    }
};

// Internal function
const generateAndValidateReferences = async (keyword: string, metaDescription: string, serperApiKey: string) => {
    if (!serperApiKey) return { html: '', data: [] };
    try {
        const currentYear = new Date().getFullYear();
        const nextYear = currentYear + 1;
        const response = await fetchWithProxies("https://google.serper.dev/search", {
            method: 'POST',
            headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: `${keyword} research ${currentYear} ${nextYear}`, num: 5 })
        });
        const json = await response.json();
        const data = (json.organic || []).map((res: any) => ({ title: res.title, url: res.link, source: new URL(res.link).hostname, year: new Date().getFullYear() })).slice(0, 5);
        let html = '';
        if (data.length > 0) html = `<div class="references-section"><h2>References</h2><ul>` + data.map((ref: any) => `<li><a href="${ref.url}">${ref.title}</a></li>`).join('') + `</ul></div>`;
        return { html, data };
    } catch (e) { return { html: '', data: [] }; }
};

export const generateContent = {
    // ... existing methods ...
    async analyzePages(
        pagesToAnalyze: SitemapPage[],
        callAI: Function,
        setExistingPages: React.Dispatch<React.SetStateAction<SitemapPage[]>>,
        onProgress: (progress: { current: number; total: number }) => void,
        shouldStop: () => boolean
    ) {
        const aiRepairer = (brokenText: string) => callAI('json_repair', [brokenText], 'json');
        await processConcurrently(
            pagesToAnalyze,
            async (page) => {
                if (shouldStop()) return;
                try {
                    setExistingPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'analyzing' } : p));
                    
                    let content = page.crawledContent;
                    if (!content || content.length < 200) {
                        content = await smartCrawl(page.id);
                        setExistingPages(prev => prev.map(p => p.id === page.id ? { ...p, crawledContent: content } : p));
                    }

                    const analysisResponse = await callAI('batch_content_analyzer', [page.title, content, null], 'json');
                    const analysisData = await parseJsonWithAiRepair(analysisResponse, aiRepairer);
                    setExistingPages(prev => prev.map(p => p.id === page.id ? { 
                        ...p, status: 'analyzed', analysis: analysisData.analysis, healthScore: analysisData.healthScore, updatePriority: analysisData.updatePriority, justification: analysisData.justification
                    } : p));
                } catch (error: any) {
                    setExistingPages(prev => prev.map(p => p.id === page.id ? { ...p, status: 'error', justification: error.message } : p));
                }
            },
            1, 
            (c, t) => onProgress({ current: c, total: t }),
            shouldStop
        );
    },
    async analyzeContentGaps(
        existingPages: SitemapPage[],
        topic: string,
        callAI: Function,
        context: GenerationContext
    ): Promise<GapAnalysisSuggestion[]> {
        const titles = existingPages.map(p => p.title).filter(t => t && t.length > 5);
        
        // SOTA: Enable Grounding for real-time trend data
        const responseText = await memoizedCallAI(
            context.apiClients, 
            context.selectedModel, 
            context.geoTargeting, 
            context.openrouterModels, 
            context.selectedGroqModel, 
            'content_gap_analyzer', 
            [titles, topic], 
            'json', 
            true // Enable Grounding
        );

        const aiRepairer = (brokenText: string) => callAI('json_repair', [brokenText], 'json');
        const parsed = await parseJsonWithAiRepair(responseText, aiRepairer);
        return parsed.suggestions || [];
    },
    async refreshItem(
        item: ContentItem,
        callAI: Function,
        context: GenerationContext,
        aiRepairer: (t: string) => Promise<string>
    ) {
        const { dispatch, existingPages, serperApiKey } = context;
        
        // 1. PREFER WP API FETCH
        let sourceContent = item.crawledContent;
        const slug = extractSlugFromUrl(item.originalUrl || item.id);

        if (!sourceContent || sourceContent.length < 200) {
            dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Fetching from WP...' } });
            try {
                const headers = new Headers({ 'Accept': 'application/json' });
                let res = await fetchWithProxies(`${context.wpConfig.url}/wp-json/wp/v2/posts?slug=${slug}&_fields=content`, { method: 'GET', headers });
                let data = await res.json();
                
                if (res.ok && Array.isArray(data) && data.length > 0) {
                     sourceContent = data[0].content.rendered;
                } else {
                    res = await fetchWithProxies(`${context.wpConfig.url}/wp-json/wp/v2/pages?slug=${slug}&_fields=content`, { method: 'GET', headers });
                    data = await res.json();
                    if (res.ok && Array.isArray(data) && data.length > 0) {
                        sourceContent = data[0].content.rendered;
                    }
                }
                
                if (!sourceContent) {
                     dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Crawling...' } });
                     sourceContent = await smartCrawl(item.originalUrl || item.id);
                }
                item.crawledContent = sourceContent;
                dispatch({ type: 'SET_CRAWLED_CONTENT', payload: { id: item.id, content: sourceContent } });

            } catch (e: any) {
                 sourceContent = await smartCrawl(item.originalUrl || item.id);
                 item.crawledContent = sourceContent;
            }
        }

        // 2. Fetch PAA Questions & Generate Semantic Keywords (SOTA Upgrade)
        dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Fetching FAQs & Semantics...' } });
        
        const [paaQuestions, semanticKeywordsResponse] = await Promise.all([
            fetchPAA(item.title, serperApiKey),
            memoizedCallAI(context.apiClients, context.selectedModel, context.geoTargeting, context.openrouterModels, context.selectedGroqModel, 'semantic_keyword_generator', [item.title, context.geoTargeting.enabled ? context.geoTargeting.location : null], 'json')
        ]);

        const semanticKeywordsRaw = await parseJsonWithAiRepair(semanticKeywordsResponse, aiRepairer);
        const semanticKeywords = Array.isArray(semanticKeywordsRaw?.semanticKeywords)
            ? semanticKeywordsRaw.semanticKeywords.map((k: any) => (typeof k === 'object' ? k.keyword : k)).slice(0, 5) // Top 5 for injection
            : [];

        // 3. Surgical Update with SOTA Requirements
        dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Generating SOTA Updates...' } });
        
        const responseText = await memoizedCallAI(
            context.apiClients, 
            context.selectedModel, 
            context.geoTargeting, 
            context.openrouterModels, 
            context.selectedGroqModel, 
            'content_refresher', 
            [sourceContent, item.title, item.title, paaQuestions, semanticKeywords], 
            'json', 
            true 
        );
        
        let parsedSnippets = await parseJsonWithAiRepair(responseText, aiRepairer);
        
        // AGGRESSIVE SCRUB (But allow HTML)
        const scrubForbiddenTerms = (text: string) => {
            if (!text) return "";
            return text
                .replace(/SOTA/gi, 'Modern') // Remove explicit "SOTA" text from output
                .replace(/State of the Art/gi, 'Industry Leading');
        };

        parsedSnippets.introHtml = scrubForbiddenTerms(parsedSnippets.introHtml);
        parsedSnippets.keyTakeawaysHtml = scrubForbiddenTerms(parsedSnippets.keyTakeawaysHtml);
        parsedSnippets.comparisonTableHtml = scrubForbiddenTerms(parsedSnippets.comparisonTableHtml);
        parsedSnippets.faqHtml = scrubForbiddenTerms(parsedSnippets.faqHtml);

        // SOTA FACT CHECKING
        if (parsedSnippets.comparisonTableHtml && serperApiKey) {
            dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Fact Checking Links...' } });
            
            const linkRegex = /href=["'](https?:\/\/[^"']+)["']/g;
            const uniqueLinks = new Set<string>();
            let match;
            while ((match = linkRegex.exec(parsedSnippets.comparisonTableHtml)) !== null) uniqueLinks.add(match[1]);

            if (uniqueLinks.size > 0) {
                const validations = await Promise.all(Array.from(uniqueLinks).map(async (url) => {
                    const result = await validateAndFixUrl(url, `${item.title} official site statistics`, serperApiKey);
                    return { original: url, ...result };
                }));

                let fixedHtml = parsedSnippets.comparisonTableHtml;
                validations.forEach(res => {
                    if (!res.valid || res.fixed) {
                        if (res.url) fixedHtml = fixedHtml.split(res.original).join(res.url);
                        else {
                            const escapedUrl = escapeRegExp(res.original);
                            const regex = new RegExp(`<a\\s+(?:[^>]*?\\s+)?href=["']${escapedUrl}["'][^>]*>(.*?)<\\/a>`, 'gi');
                            fixedHtml = fixedHtml.replace(regex, '$1').split(res.original).join('#');
                        }
                    }
                });
                parsedSnippets.comparisonTableHtml = fixedHtml;
            }
        }
        
        // 4. Normalize & Output
        const generated = normalizeGeneratedContent({}, item.title);
        generated.title = parsedSnippets.seoTitle || item.title;
        generated.metaDescription = parsedSnippets.metaDescription || '';
        generated.semanticKeywords = semanticKeywords; // Store them for schema
        
        // Generate Preview HTML including FAQs
        generated.content = `
            <div class="sota-update-preview">
                <div class="preview-section">
                    <h3>🔥 New Intro (SOTA Snippet Trap)</h3>
                    ${parsedSnippets.introHtml}
                </div>
                <hr style="border-top: 1px dashed #ccc; margin: 2rem 0;">
                <div class="preview-section">
                    <h3>💡 Key Takeaways</h3>
                    ${parsedSnippets.keyTakeawaysHtml}
                </div>
                <hr style="border-top: 1px dashed #ccc; margin: 2rem 0;">
                <div class="preview-section">
                    <h3>📊 Comparison Table</h3>
                    ${parsedSnippets.comparisonTableHtml}
                </div>
                <hr style="border-top: 1px dashed #ccc; margin: 2rem 0;">
                <div class="preview-section">
                    <h3>❓ SOTA FAQs (PAA Based)</h3>
                    ${parsedSnippets.faqHtml || '<p>No FAQs generated.</p>'}
                </div>
            </div>
        `;
        
        // SOTA: Persist surgical snippets for the Publishing phase
        generated.surgicalSnippets = {
            introHtml: parsedSnippets.introHtml,
            keyTakeawaysHtml: parsedSnippets.keyTakeawaysHtml,
            comparisonTableHtml: parsedSnippets.comparisonTableHtml,
            faqHtml: parsedSnippets.faqHtml
        };
        
        if (item.originalUrl) generated.slug = extractSlugFromUrl(item.originalUrl);

        // Skip verification footer for refresh items
        generated.content = postProcessGeneratedHtml(generated.content, generated, null, context.siteInfo, true);

        dispatch({ type: 'SET_CONTENT', payload: { id: item.id, content: generated } });
        dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'done', statusText: 'Refreshed' } });
    },
    async generateItems(
        itemsToGenerate: ContentItem[],
        callAI: Function,
        generateImage: Function,
        context: GenerationContext,
        onProgress: (progress: { current: number; total: number }) => void,
        shouldStop: () => React.MutableRefObject<Set<string>>
    ) {
        const { dispatch, existingPages, siteInfo, wpConfig, geoTargeting, serperApiKey, neuronConfig } = context;
        const aiRepairer = (brokenText: string) => callAI('json_repair', [brokenText], 'json');

        await processConcurrently(itemsToGenerate, async (item) => {
            if (shouldStop().current.has(item.id)) return;
            try {
                if (item.type === 'refresh') {
                    await generateContent.refreshItem(item, callAI, context, aiRepairer);
                    return;
                }

                let neuronDataString = '';
                let neuronAnalysisRaw: any = null;
                if (neuronConfig.enabled) {
                     try {
                         dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'NeuronWriter Analysis...' } });
                         neuronAnalysisRaw = await getNeuronWriterAnalysis(item.title, neuronConfig);
                         neuronDataString = formatNeuronDataForPrompt(neuronAnalysisRaw);
                     } catch (e) { console.error(e); }
                }

                // SOTA: BUILD AUDIT DATA FOR REWRITE
                let auditDataString = '';
                if (item.analysis) {
                    auditDataString = `
                    **CRITICAL AUDIT & IMPROVEMENT MANDATE:**
                    This is a REWRITE of an underperforming article. You MUST fix the following issues identified by our SEO Auditor:
                    
                    **Critique:** ${item.analysis.critique || 'N/A'}
                    **Missing Content Gaps (MUST ADD):**
                    ${(item.analysis as any).contentGaps ? (item.analysis as any).contentGaps.map((g:string) => `- ${g}`).join('\n') : 'N/A'}
                    **Improvement Plan:** ${(item.analysis as any).improvementPlan || 'N/A'}
                    
                    **YOUR JOB IS TO EXECUTE THIS PLAN PERFECTLY.**
                    `;
                }

                dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Checking News...' } });
                const recentNews = await fetchRecentNews(item.title, serperApiKey);

                dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Generating...' } });
                const serpData: any[] = [];
                
                const [semanticKeywordsResponse, outlineResponse] = await Promise.all([
                    memoizedCallAI(context.apiClients, context.selectedModel, geoTargeting, context.openrouterModels, context.selectedGroqModel, 'semantic_keyword_generator', [item.title, geoTargeting.enabled ? geoTargeting.location : null], 'json'),
                    memoizedCallAI(context.apiClients, context.selectedModel, geoTargeting, context.openrouterModels, context.selectedGroqModel, 'content_meta_and_outline', [item.title, null, serpData, null, existingPages, item.crawledContent, item.analysis, neuronDataString], 'json')
                ]);
                
                const semanticKeywordsRaw = await parseJsonWithAiRepair(semanticKeywordsResponse, aiRepairer);
                const semanticKeywords = Array.isArray(semanticKeywordsRaw?.semanticKeywords)
                    ? semanticKeywordsRaw.semanticKeywords.map((k: any) => (typeof k === 'object' ? k.keyword : k))
                    : [];

                let articlePlan = await parseJsonWithAiRepair(outlineResponse, aiRepairer);
                let generated = normalizeGeneratedContent(articlePlan, item.title);
                generated.semanticKeywords = semanticKeywords;
                if (neuronAnalysisRaw) generated.neuronAnalysis = neuronAnalysisRaw;

                dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'generating', statusText: 'Writing assets...' } });
                const { html: referencesHtml, data: referencesData } = await generateAndValidateReferences(generated.primaryKeyword, generated.metaDescription, serperApiKey);
                generated.references = referencesData;

                const availableLinkData = existingPages
                    .filter(p => p.slug && p.title && p.status !== 'error')
                    .slice(0, 100)
                    .map(p => `- Title: "${p.title}", Slug: "${p.slug}"`)
                    .join('\n');

                const [fullHtml, images, youtubeVideos] = await Promise.all([
                    memoizedCallAI(context.apiClients, context.selectedModel, geoTargeting, context.openrouterModels, context.selectedGroqModel, 'ultra_sota_article_writer', [generated, existingPages, referencesHtml, neuronDataString, availableLinkData, recentNews, auditDataString], 'html'),
                    Promise.all(generated.imageDetails.map(detail => generateImage(detail.prompt))),
                    getGuaranteedYoutubeVideos(item.title, serperApiKey, semanticKeywords)
                ]);

                try { enforceWordCount(fullHtml, TARGET_MIN_WORDS, TARGET_MAX_WORDS); } catch (e) { }

                generated.content = postProcessGeneratedHtml(fullHtml, generated, youtubeVideos, siteInfo, false) + referencesHtml;
                generated.content = processInternalLinks(generated.content, existingPages);
                images.forEach((img, i) => { if (img) generated.imageDetails[i].generatedImageSrc = img; });
                
                const schemaGenerator = lazySchemaGeneration(generated, wpConfig, siteInfo, geoTargeting);
                const schemaMarkup = schemaGenerator();
                const scriptMatch = schemaMarkup.match(/<script.*?>([\s\S]*)<\/script>/);
                if (scriptMatch) generated.jsonLdSchema = JSON.parse(scriptMatch[1]);
                
                dispatch({ type: 'SET_CONTENT', payload: { id: item.id, content: generated } });
                dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'done', statusText: 'Completed' } });

            } catch (error: any) {
                dispatch({ type: 'UPDATE_STATUS', payload: { id: item.id, status: 'error', statusText: error.message } });
            }
        }, 1, (c, t) => onProgress({ current: c, total: t }), () => shouldStop().current.size > 0);
    }
};
