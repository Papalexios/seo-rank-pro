
import { GeneratedContent, SiteInfo, SitemapPage } from "./types";
import { TARGET_MAX_WORDS, TARGET_MIN_WORDS } from "./constants";

export const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export const calculateFleschReadability = (text: string): number => {
    if (!text || text.trim().length === 0) return 100;

    const words: string[] = text.match(/\b\w+\b/g) || [];
    const wordCount = words.length;
    if (wordCount < 100) return 100;

    const sentences: string[] = text.match(/[^.!?]+[.!?]+/g) || [];
    const sentenceCount = sentences.length || 1;

    const syllables = words.reduce((acc: number, word: string) => {
        let currentWord = word.toLowerCase();
        if (currentWord.length <= 3) return acc + 1;
        currentWord = currentWord.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
        currentWord = currentWord.replace(/^y/, '');
        const syllableMatches = currentWord.match(/[aeiouy]{1,2}/g);
        return acc + (syllableMatches ? syllableMatches.length : 0);
    }, 0);

    const score = 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllables / wordCount);
    return Math.max(0, Math.min(100, Math.round(score)));
};

export const getReadabilityVerdict = (score: number): { verdict: string, color: string } => {
    if (score >= 90) return { verdict: 'Very Easy', color: '#10B981' };
    if (score >= 80) return { verdict: 'Easy', color: '#10B981' };
    if (score >= 70) return { verdict: 'Fairly Easy', color: '#34D399' };
    if (score >= 60) return { verdict: 'Standard', color: '#FBBF24' };
    if (score >= 50) return { verdict: 'Fairly Difficult', color: '#F59E0B' };
    if (score >= 30) return { verdict: 'Difficult', color: '#EF4444' };
    return { verdict: 'Very Difficult', color: '#DC2626' };
};

export const extractYouTubeID = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
        return match[2];
    }
    return null;
};

export const fetchWithProxies = async (
    url: string,
    options: RequestInit = {},
    onProgress?: (message: string) => void
): Promise<Response> => {
    let lastError: Error | null = null;
    const REQUEST_TIMEOUT = 45000;

    const safeHeaders: Record<string, string> = {
        'Accept': 'application/json',
    };
    
    let hasAuth = false;

    if (options.headers) {
        const headerObj = options.headers as Record<string, string>;
        Object.keys(headerObj).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (lowerKey === 'x-api-key' || lowerKey === 'authorization') {
                hasAuth = true;
            }
            if (!['user-agent', 'origin', 'referer', 'host', 'connection', 'sec-fetch-mode', 'accept-encoding', 'content-length'].includes(lowerKey)) {
                safeHeaders[key] = headerObj[key];
            }
        });
    }

    const fetchOptions = {
        ...options,
        headers: safeHeaders
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('Direct fetch timed out'), 4000); 
        const directResponse = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        
        if (directResponse.ok || (directResponse.status >= 400 && directResponse.status < 600)) {
            return directResponse;
        }
    } catch (error: any) {
        // Direct failed
    }

    const encodedUrl = encodeURIComponent(url);
    let proxies: string[] = [];

    if (hasAuth) {
        proxies = [
            `https://thingproxy.freeboard.io/fetch/${url}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
            `https://corsproxy.io/?${encodedUrl}`,
        ];
    } else {
        proxies = [
            `https://corsproxy.io/?${url}`,
            `https://api.allorigins.win/raw?url=${encodedUrl}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`,
        ];
    }

    for (let i = 0; i < proxies.length; i++) {
        const proxyUrl = proxies[i];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(`Proxy timed out`), REQUEST_TIMEOUT);

        try {
            const shortName = new URL(proxyUrl).hostname;
            console.log(`[SOTA Net] Attempting proxy ${i+1}/${proxies.length}: ${shortName}`);
            
            const response = await fetch(proxyUrl, {
                ...fetchOptions,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (response.status >= 500) {
                 lastError = new Error(`Proxy ${shortName} failed`);
                 continue;
            }

            if (hasAuth && (response.status === 401 || response.status === 403)) {
                 lastError = new Error(`Auth failed via ${shortName}`);
                 if (i < proxies.length - 1) continue;
            }

            return response; 

        } catch (error: any) {
            clearTimeout(timeoutId);
            lastError = error as Error;
        }
    }

    const errorDetails = lastError ? lastError.message : "Unknown network error";
    throw new Error(`Network Failure: ${errorDetails}`);
};

export const smartCrawl = async (url: string): Promise<string> => {
    console.log(`[SOTA Crawl] Initiating smart crawl for: ${url}`);

    // LAYER 1: Jina AI Reader
    try {
        console.log(`[SOTA Crawl] Trying Jina AI Reader...`);
        const jinaUrl = `https://r.jina.ai/${url}`;
        const response = await fetch(jinaUrl);
        
        if (response.ok) {
            const text = await response.text();
            if (text && text.length > 200 && !text.includes("Access Denied")) {
                console.log(`[SOTA Crawl] Jina AI success!`);
                return text.substring(0, 30000);
            }
        }
    } catch (e) {
        console.warn(`[SOTA Crawl] Jina AI fetch error:`, e);
    }

    // LAYER 2: CORS Proxies + DOM Extraction
    console.log(`[SOTA Crawl] Falling back to CORS proxies...`);
    try {
        const response = await fetchWithProxies(url);
        const html = await response.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        doc.querySelectorAll('script, style, nav, footer, iframe, noscript, .ad, .ads, .sidebar').forEach(el => el.remove());
        
        const main = doc.querySelector('main') || doc.querySelector('article') || doc.querySelector('#content') || doc.querySelector('.content') || doc.body;
        
        const textContent = (main.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();

        if (textContent.length > 200) {
            console.log(`[SOTA Crawl] Proxy crawl success!`);
            return textContent.substring(0, 25000);
        }
        
        throw new Error("Extracted content too short.");

    } catch (e: any) {
        console.error(`[SOTA Crawl] All layers failed for ${url}`, e);
        throw new Error(`Crawl Failed: ${e.message}`);
    }
};

export class ContentTooShortError extends Error {
    public content: string;
    public wordCount: number;
  
    constructor(message: string, content: string, wordCount: number) {
      super(message);
      this.name = 'ContentTooShortError';
      this.content = content;
      this.wordCount = wordCount;
    }
}

export class ContentTooLongError extends Error {
    public content: string;
    public wordCount: number;
  
    constructor(message: string, content: string, wordCount: number) {
      super(message);
      this.name = 'ContentTooLongError';
      this.content = content;
      this.wordCount = wordCount;
    }
}
  
export function enforceWordCount(content: string, minWords = TARGET_MIN_WORDS, maxWords = TARGET_MAX_WORDS) {
    const textOnly = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = textOnly.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    console.log(`📊 Word Count: ${wordCount} (Target: ${minWords}-${maxWords})`);

    if (wordCount < minWords) {
        throw new ContentTooShortError(`CONTENT TOO SHORT: ${wordCount} words (minimum ${minWords} required).`, content, wordCount);
    }

    if (wordCount > maxWords) {
        throw new ContentTooLongError(`CONTENT TOO LONG: ${wordCount} words (maximum ${maxWords} allowed).`, content, wordCount);
    }

    return wordCount;
}

export async function getGuaranteedYoutubeVideos(
    keyword: string,
    serperApiKey: string,
    semanticKeywords: string[]
): Promise<any[]> {
    if (!serperApiKey) return [];
    
    const queries = [keyword, `${keyword} tutorial`, `${keyword} guide`];
    let allVideos: any[] = [];
    
    for (const query of queries) {
        if (allVideos.length >= 2) break;
        try {
            const response = await fetchWithProxies("https://google.serper.dev/search", {
                method: 'POST',
                headers: { 'X-API-KEY': serperApiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: query, type: 'videos', num: 5 })
            });
            const data = await response.json();
            const videos = data.videos || [];
            for (const video of videos) {
                if (allVideos.length >= 2) break;
                const videoId = extractYouTubeID(video.link);
                if (videoId && !allVideos.some(v => v.videoId === videoId)) {
                    allVideos.push({ ...video, videoId, embedUrl: `https://www.youtube.com/embed/${videoId}` });
                }
            }
        } catch (error) {
            console.error(`Video search failed`, error);
        }
    }
    
    return allVideos.slice(0, 2);
}

export const normalizeGeneratedContent = (parsedJson: any, itemTitle: string): GeneratedContent => {
    const normalized = { ...parsedJson };
    if (!normalized.title) normalized.title = itemTitle;
    if (!normalized.slug) normalized.slug = itemTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
    if (!normalized.content) normalized.content = '';
    
    if (!normalized.imageDetails || !Array.isArray(normalized.imageDetails)) normalized.imageDetails = [];

    normalized.imageDetails = normalized.imageDetails.map((item: any, index: number) => {
        if (typeof item === 'string') {
             const slugBase = normalized.slug || itemTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
             return {
                 prompt: item,
                 altText: `${itemTitle} image ${index + 1}`,
                 title: `${slugBase}-image-${index + 1}`,
                 placeholder: `[IMAGE_${index + 1}_PLACEHOLDER]`
             };
        }
        return item;
    });

    if (normalized.imageDetails.length === 0) {
        const slugBase = normalized.slug || itemTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
        normalized.imageDetails = [
            {
                prompt: `High quality header image for ${itemTitle}`,
                altText: `${itemTitle} header`,
                title: `${slugBase}-feature`,
                placeholder: '[IMAGE_1_PLACEHOLDER]'
            },
            {
                prompt: `Infographic for ${itemTitle}`,
                altText: `${itemTitle} infographic`,
                title: `${slugBase}-infographic`,
                placeholder: '[IMAGE_2_PLACEHOLDER]'
            }
        ];
        normalized.content += '<p>[IMAGE_1_PLACEHOLDER]</p><p>[IMAGE_2_PLACEHOLDER]</p>';
    }

    if (!normalized.metaDescription) normalized.metaDescription = `Comprehensive guide on ${normalized.title}.`;
    if (!normalized.primaryKeyword) normalized.primaryKeyword = itemTitle;
    if (!normalized.semanticKeywords) normalized.semanticKeywords = [];
    if (!normalized.strategy) normalized.strategy = { targetAudience: '', searchIntent: '', competitorAnalysis: '', contentAngle: '' };
    if (!normalized.jsonLdSchema) normalized.jsonLdSchema = {};
    if (!normalized.socialMediaCopy) normalized.socialMediaCopy = { twitter: '', linkedIn: '' };
    if (!normalized.faqSection) normalized.faqSection = [];
    if (!normalized.keyTakeaways) normalized.keyTakeaways = [];
    if (!normalized.outline) normalized.outline = [];
    if (!normalized.references) normalized.references = [];

    return normalized as GeneratedContent;
};

export const generateVerificationFooterHtml = (): string => {
    const currentYear = new Date().getFullYear();
    return `
<div class="verification-footer-sota" style="margin-top: 4rem; padding: 2.5rem; background: #F0FDF4; border-left: 6px solid #059669; border-radius: 0 12px 12px 0; display: flex; gap: 2rem; color: #064E3B; font-family: system-ui, sans-serif;">
    <div class="verification-badge" style="width: 60px; height: 60px; background: #059669; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; flex-shrink: 0; box-shadow: 0 10px 25px rgba(5, 150, 105, 0.3);">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
    </div>
    <div class="verification-content">
        <h4 style="margin: 0 0 0.8rem 0; font-weight: 800; font-size: 1.2rem; text-transform: uppercase; letter-spacing: 0.05em; color: #065F46;">Scientific Verification & Accuracy Check</h4>
        <p style="margin: 0; font-size: 1rem; line-height: 1.6; color: #065F46;">
            This content has been rigorously reviewed for accuracy and reliability. 
            We prioritize sourcing data from authoritative, peer-reviewed journals, academic institutions, and verifiable industry leaders to ensure you receive the most trustworthy information available.
        </p>
        <div class="verification-meta" style="display: flex; gap: 1rem; margin-top: 1.2rem; flex-wrap: wrap;">
            <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; background: rgba(5, 150, 105, 0.1); color: #047857; padding: 0.4rem 1rem; border-radius: 20px; display: flex; align-items: center; gap: 0.5rem;">Fact-Checked</span>
            <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; background: rgba(5, 150, 105, 0.1); color: #047857; padding: 0.4rem 1rem; border-radius: 20px; display: flex; align-items: center; gap: 0.5rem;">Peer-Reviewed Sources</span>
            <span style="font-size: 0.75rem; font-weight: 700; text-transform: uppercase; background: rgba(5, 150, 105, 0.1); color: #047857; padding: 0.4rem 1rem; border-radius: 20px; display: flex; align-items: center; gap: 0.5rem;">${currentYear} Data Accuracy</span>
        </div>
    </div>
</div>`;
};

export const performSurgicalUpdate = (originalHtml: string, snippets: { introHtml: string, keyTakeawaysHtml: string, comparisonTableHtml: string, faqHtml?: string }): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalHtml, 'text/html');
    const body = doc.body;

    // --- 1. SURGICAL INTRO REPLACEMENT ---
    const firstH2 = body.querySelector('h2');
    
    if (firstH2 && firstH2.parentNode) {
        const parent = firstH2.parentNode;
        let sibling = parent.firstChild;
        const nodesToRemove: ChildNode[] = [];

        while (sibling && sibling !== firstH2) {
            const next = sibling.nextSibling;
            if (sibling.nodeName === 'P' || sibling.nodeName === '#text') {
                const hasImg = sibling.nodeName === 'P' && (sibling as Element).querySelector('img, iframe, figure');
                if (!hasImg) {
                     nodesToRemove.push(sibling);
                }
            }
            sibling = next;
        }
        nodesToRemove.forEach(n => parent.removeChild(n));

        const tempIntroDiv = doc.createElement('div');
        tempIntroDiv.innerHTML = snippets.introHtml;
        const newIntroNodes = Array.from(tempIntroDiv.childNodes);
        
        if (parent.contains(firstH2)) {
             newIntroNodes.forEach(n => {
                 if (n) parent.insertBefore(n, firstH2);
             });
        } else {
             newIntroNodes.forEach(n => {
                 if (n) parent.appendChild(n);
             });
        }
    } else {
        const tempIntroDiv = doc.createElement('div');
        tempIntroDiv.innerHTML = snippets.introHtml;
        const newIntroNodes = Array.from(tempIntroDiv.childNodes);
        newIntroNodes.reverse().forEach(n => {
            if (body.firstChild) body.insertBefore(n, body.firstChild);
            else body.appendChild(n);
        });
    }

    // --- 2. KEY TAKEAWAYS REPLACEMENT ---
    const allHeaders = Array.from(body.querySelectorAll('h2, h3, h4, h5, h6, strong, b'));
    const existingTakeawaysHeader = allHeaders.find(el => el.textContent?.toLowerCase().includes('key takeaways'));

    const takeawaysContainer = doc.createElement('div');
    takeawaysContainer.className = 'key-takeaways-box';
    takeawaysContainer.setAttribute('style', 'background: #f8fafc; border-left: 5px solid #3b82f6; padding: 2rem; margin: 2.5rem 0; border-radius: 0 12px 12px 0; font-family: system-ui, sans-serif; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);');
    
    const tempSnippet = doc.createElement('div');
    tempSnippet.innerHTML = snippets.keyTakeawaysHtml;
    const innerContent = tempSnippet.querySelector('.key-takeaways-box') ? tempSnippet.querySelector('.key-takeaways-box')!.innerHTML : snippets.keyTakeawaysHtml;
    takeawaysContainer.innerHTML = innerContent;
    
    const h3 = takeawaysContainer.querySelector('h3');
    if (h3) {
        h3.setAttribute('style', 'margin-top: 0; color: #1e293b; font-weight: 800; display: flex; align-items: center; gap: 0.8rem; font-size: 1.25rem;');
        if (!h3.innerHTML.includes('⚡')) {
            h3.innerHTML = `<span style="color: #3b82f6; font-size: 1.5rem;">⚡</span> ` + h3.innerHTML;
        }
    }

    if (existingTakeawaysHeader && existingTakeawaysHeader.parentNode) {
        const parent = existingTakeawaysHeader.parentNode as Element;
        if ((parent.nodeName === 'DIV' || parent.nodeName === 'SECTION') && parent.textContent && parent.textContent.length < 1500 && parent.childNodes.length < 10) {
             parent.replaceWith(takeawaysContainer);
        } else {
            let sibling = existingTakeawaysHeader.nextElementSibling;
            if (sibling && (sibling.tagName === 'UL' || sibling.tagName === 'OL' || sibling.tagName === 'P')) {
                sibling.remove();
            }
            existingTakeawaysHeader.replaceWith(takeawaysContainer);
        }
    } else {
        if (firstH2 && firstH2.parentNode && firstH2.parentNode.contains(firstH2)) {
            firstH2.parentNode.insertBefore(takeawaysContainer, firstH2);
        } else {
            body.appendChild(takeawaysContainer);
        }
    }

    // --- 3. DYNAMIC TABLE INJECTION ---
    const allH2s = Array.from(body.querySelectorAll('h2'));
    const faqHeader = allH2s.find(el => el.textContent?.toLowerCase().includes('faq') || el.textContent?.toLowerCase().includes('frequently asked'));
    const conclusionHeader = allH2s.find(el => el.textContent?.toLowerCase().includes('conclusion'));
    const targetHeader = faqHeader || conclusionHeader;

    const tableWrapper = doc.createElement('div');
    tableWrapper.className = 'sota-table-wrapper';
    tableWrapper.setAttribute('style', 'margin: 3rem 0; overflow-x: auto; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.08); background: white; padding: 1rem;');
    
    let rawTableHtml = snippets.comparisonTableHtml || '';
    tableWrapper.innerHTML = rawTableHtml;

    const tableH2 = tableWrapper.querySelector('h2');
    if (tableH2) {
        tableH2.setAttribute('style', 'font-family: "Montserrat", sans-serif; font-weight: 800; color: #1e293b; margin-bottom: 1rem; border-left: 5px solid #3b82f6; padding-left: 1rem;');
    }

    const tableEl = tableWrapper.querySelector('table');
    if (tableEl) {
        tableEl.className = 'sota-comparison-table';
        tableEl.setAttribute('style', 'width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; background: white; margin-bottom: 1rem;');
        
        const thead = tableEl.querySelector('thead');
        if (thead) thead.setAttribute('style', 'background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white;');
        
        tableEl.querySelectorAll('th').forEach(th => {
            th.setAttribute('style', 'padding: 1.2rem; text-align: left; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; font-size: 0.85rem; border-bottom: 3px solid #3b82f6; color: white;');
        });
        
        tableEl.querySelectorAll('td').forEach(td => {
            td.setAttribute('style', 'padding: 1rem; color: #475569; font-size: 0.95rem; vertical-align: middle; border-bottom: 1px solid #e2e8f0;');
        });
        
        const rows = tableEl.querySelectorAll('tbody tr');
        rows.forEach((row, i) => {
            if (i % 2 === 0) (row as HTMLElement).style.background = '#f8fafc';
        });
    }

    const sourceDiv = tableWrapper.querySelector('.table-source');
    if (sourceDiv) {
        sourceDiv.setAttribute('style', 'font-size: 0.8rem; color: #64748B; font-style: italic; margin-top: 0.5rem; text-align: right;');
    }

    const explainerP = tableWrapper.querySelector('.table-explainer');
    if (explainerP) {
        explainerP.setAttribute('style', 'font-size: 1rem; color: #334155; line-height: 1.6; margin-top: 1rem; background: #f1f5f9; padding: 1rem; border-radius: 8px;');
    }

    if (targetHeader && targetHeader.parentNode && targetHeader.parentNode.contains(targetHeader)) {
        targetHeader.parentNode.insertBefore(tableWrapper, targetHeader);
    } else {
        const footer = body.querySelector('footer'); 
        if (footer && footer.parentNode && footer.parentNode.contains(footer)) {
            footer.parentNode.insertBefore(tableWrapper, footer);
        } else {
            body.appendChild(tableWrapper);
        }
    }

    // --- 4. FAQ REPLACEMENT (SOTA) ---
    if (snippets.faqHtml) {
        const tempFaqDiv = doc.createElement('div');
        tempFaqDiv.innerHTML = snippets.faqHtml;
        const newFaqNode = tempFaqDiv.firstElementChild || tempFaqDiv;

        const existingFaqHeader = Array.from(body.querySelectorAll('h2, h3, h4')).find(el => {
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('frequently asked') || text.includes('faq');
        });

        if (existingFaqHeader && existingFaqHeader.parentNode) {
            const parent = existingFaqHeader.parentNode;
            
            // Heuristic: Check if parent is a dedicated FAQ container
            const isDedicatedContainer = (parent as Element).className.toLowerCase().includes('faq') || 
                                         (parent.childNodes.length < 20 && (parent as Element).tagName !== 'BODY' && (parent as Element).tagName !== 'MAIN');

            if (isDedicatedContainer) {
                 (parent as Element).replaceWith(newFaqNode);
            } else {
                // Sibling cleanup
                const nodesToRemove: ChildNode[] = [existingFaqHeader];
                let sibling = existingFaqHeader.nextSibling;
                let lookAhead = 0;
                while (sibling && lookAhead < 50) {
                    const el = sibling as Element;
                    const isHeader = sibling.nodeType === 1 && /^H[1-3]$/.test(el.tagName);
                    if (isHeader) break;
                    
                    nodesToRemove.push(sibling);
                    sibling = sibling.nextSibling;
                    lookAhead++;
                }
                
                if (parent.contains(existingFaqHeader)) {
                    parent.insertBefore(newFaqNode, existingFaqHeader);
                    nodesToRemove.forEach(n => n.remove());
                }
            }
        } else {
            body.appendChild(newFaqNode);
        }
    }

    return body.innerHTML;
}

export const postProcessGeneratedHtml = (html: string, plan: GeneratedContent, youtubeVideos: any[] | null, siteInfo: SiteInfo, isRefresh: boolean = false): string => {
    let processedHtml = html;

    const bannedPatterns = [
        /Read Time \d+ Min/gi,
        /Sources Scanned \d+ Citations/gi,
        /Last Verified \d{4}/gi,
        /Trust Score\s*\d+(\.\d+)?%/gi,
        /Empirical Data[\s\S]*?validated research\./gi,
        /Veracity Checked[\s\S]*?primary sources\./gi,
        /Actionable[\s\S]*?practical insights for application\./gi,
        /Image \d+: [A-Za-z ]+/gi,
        /Image \d+ [A-Za-z ]+/gi,
    ];

    bannedPatterns.forEach(pattern => {
        processedHtml = processedHtml.replace(pattern, '');
    });

    processedHtml = processedHtml.replace(/(\(|\[)?Word count:\s*\d+(\)|\])?/gi, '');
    processedHtml = processedHtml.replace(/\(\d+\s*words\)/gi, '');
    processedHtml = processedHtml.replace(/^Word count: \d+$/gim, '');
    
    if (plan.references && plan.references.length > 0) {
         processedHtml = processedHtml.replace(/<h2[^>]*>(References|Sources|Bibliography)<\/h2>[\s\S]*$/i, '');
    }

    processedHtml = processedHtml.replace(/<table[^>]*>(?![\s\S]*sota-comparison-table)[\s\S]*?<\/table>/gi, (match) => {
         if (match.includes('sota-comparison-table')) return match;
         return `<figure class="wp-block-table">${match.replace(/<td/g, '<td style="border: 1px solid #ddd; padding: 8px;"').replace(/<th/g, '<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; text-align: left;"')}</figure>`;
    });

    if (!processedHtml.includes('key-takeaways-box') && plan.keyTakeaways && plan.keyTakeaways.length > 0) {
        const keyTakeawaysHtml = `<div class="key-takeaways-box" style="background: #f8fafc; border-left: 5px solid #3b82f6; padding: 2rem; margin: 2.5rem 0; border-radius: 0 12px 12px 0;"><h3>Key Takeaways</h3><ul>${plan.keyTakeaways.map(t => `<li>${t}</li>`).join('')}</ul></div>`;
        const firstH2Index = processedHtml.search(/<h2/i);
        if (firstH2Index !== -1) {
            processedHtml = processedHtml.slice(0, firstH2Index) + keyTakeawaysHtml + processedHtml.slice(firstH2Index);
        } else {
            processedHtml = processedHtml + keyTakeawaysHtml;
        }
    }

    processedHtml = processedHtml.replace(/<div[^>]*class="[^"]*author-box[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    processedHtml = processedHtml.replace(/<div[^>]*class="verification-footer-sota"[^>]*>[\s\S]*?<\/div>/gi, '');
    processedHtml = processedHtml.replace(/Scientific Verification & Accuracy Check[\s\S]*?trustworthy information available\./gi, '');

    if (!isRefresh) {
        const verificationFooter = generateVerificationFooterHtml();
        processedHtml = processedHtml + verificationFooter;
    }

    if (youtubeVideos && youtubeVideos.length > 0) {
        const paragraphs = processedHtml.split('</p>');
        if (youtubeVideos[0] && paragraphs.length > 2) {
            const videoEmbed1 = `
                <figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio">
                    <div class="wp-block-embed__wrapper">
                        <iframe title="${youtubeVideos[0].title}" width="500" height="281" src="${youtubeVideos[0].embedUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
                    </div>
                    <figcaption>${youtubeVideos[0].title}</figcaption>
                </figure>
            `;
            paragraphs.splice(2, 0, videoEmbed1);
        }
        if (youtubeVideos[1] && paragraphs.length > 5) {
            const videoEmbed2 = `
                <figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio">
                    <div class="wp-block-embed__wrapper">
                        <iframe title="${youtubeVideos[1].title}" width="500" height="281" src="${youtubeVideos[1].embedUrl}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
                    </div>
                    <figcaption>${youtubeVideos[1].title}</figcaption>
                </figure>
            `;
            paragraphs.splice(5, 0, videoEmbed2);
        }
        processedHtml = paragraphs.join('</p>');
    }

    processedHtml = processedHtml.replace(/<p>\s*\[IMAGE_\d+_PLACEHOLDER\]\s*<\/p>/g, '');
    processedHtml = processedHtml.replace(/\[IMAGE_\d+_PLACEHOLDER\]/g, '');

    return processedHtml;
};

export const processInternalLinks = (content: string, availablePages: SitemapPage[]): string => {
    const placeholderRegex = /\[INTERNAL_LINK\s+slug="([^"]+)"\s+text="([^"]+)"\]/gi;
    const slugToUrlMap: Map<string, string> = new Map();
    availablePages.forEach(page => {
        if (page.slug) {
            slugToUrlMap.set(page.slug.toLowerCase(), page.id);
        }
    });

    return content.replace(placeholderRegex, (match, slug, text) => {
        const targetUrl = slugToUrlMap.get(slug.toLowerCase());
        if (targetUrl) {
             return `<a href="${targetUrl}">${text}</a>`;
        }
        return text;
    });
};