


import { NeuronConfig } from "./types";
import { fetchWithProxies } from "./contentUtils";

const NEURON_API_BASE = "https://app.neuronwriter.com/neuron-api/0.5/writer";

export interface NeuronProject {
    project: string;
    name: string;
    language: string;
    engine: string;
    domain?: string;
}

export interface NeuronAnalysisResult {
    status: string;
    terms_txt?: {
        title: string;
        h1: string;
        h2: string;
        content_basic: string;
        content_extended: string;
    };
    metrics?: {
        word_count: { target: number };
    };
    competitors?: any[];
}

/**
 * Fetches the list of projects available for the given API key.
 * Uses robust error handling and SOTA proxy fallback to bypass CORS.
 */
export async function listNeuronProjects(apiKey: string): Promise<NeuronProject[]> {
    if (!apiKey || apiKey.trim().length < 5) return [];
    
    try {
        // SOTA FIX: Use fetchWithProxies to bypass browser CORS restrictions
        // Endpoint correction: /list-projects (not /projects)
        const response = await fetchWithProxies(`${NEURON_API_BASE}/list-projects`, {
            method: 'POST', 
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({}) 
        });

        // Handle 404 specifically for endpoints, but 401/403 are key
        if (!response.ok) {
             if (response.status === 401 || response.status === 403) {
                 throw new Error("Invalid NeuronWriter API Key");
             }
             const errText = await response.text();
             throw new Error(`NeuronWriter Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        
        // Validate response structure
        if (Array.isArray(data)) {
            return data as NeuronProject[];
        } else if (data && Array.isArray(data.projects)) {
             return data.projects as NeuronProject[];
        } else if (data && data.project) {
            // Handle single project response just in case
            return [data] as NeuronProject[];
        }
        
        return [];
    } catch (error: any) {
        console.error("[NeuronWriter] List projects failed:", error);
        // Enhance error message for UI
        if (error.message.includes('Failed to connect') || error.message.includes('Network Error')) {
             throw new Error(`Network Error: Could not connect to NeuronWriter. (CORS/Blocked) - ${error.message}`);
        }
        throw error;
    }
}

/**
 * Creates a new analysis query in NeuronWriter with robust error handling.
 */
async function createNeuronQuery(keyword: string, config: NeuronConfig): Promise<string> {
    // SOTA FIX: API requires full language name "English", not "en".
    // We default to English for now as the app doesn't have a language selector yet.
    const language = "English"; 

    const response = await fetchWithProxies(`${NEURON_API_BASE}/new-query`, {
        method: "POST",
        headers: {
            "X-API-KEY": config.apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            project: config.projectId,
            keyword,
            engine: "google.com",
            language: language, 
            competitors_mode: "top-intent" // Use top-intent for better semantic matching
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        if (response.status === 401) throw new Error("NeuronWriter API Key invalid.");
        if (response.status === 403) throw new Error("NeuronWriter: Forbidden (Check quota).");
        throw new Error(`NeuronWriter new-query failed: ${response.status} - ${text}`);
    }
    
    const data = await response.json();
    if (!data.query) {
         throw new Error("NeuronWriter did not return a query ID.");
    }
    return data.query;
}

/**
 * Polls the NeuronWriter API with exponential backoff and jitter until the analysis is ready.
 */
async function pollNeuronQuery(queryId: string, config: NeuronConfig, maxAttempts = 40): Promise<NeuronAnalysisResult> {
    // Jittered exponential backoff: wait longer between each retry
    const getDelay = (i: number) => 2000 * Math.pow(1.15, i) + Math.random() * 750;
    
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, getDelay(i)));
        
        const response = await fetchWithProxies(`${NEURON_API_BASE}/get-query`, {
            method: "POST",
            headers: {
                "X-API-KEY": config.apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ query: queryId }),
        });

        if (response.status === 401) throw new Error("NeuronWriter API KEY invalid.");
        if (response.status === 403) throw new Error("NeuronWriter: Forbidden.");
        
        if (!response.ok) {
            // Transient error, wait and retry
            console.warn(`NeuronWriter polling error ${response.status}, retrying...`);
            continue;
        }

        const data = await response.json();
        
        if (data.status === "ready") return data;
        if (data.status === "not found") throw new Error("NeuronWriter query not found or expired.");
        // If "processing" or "waiting", loop continues
    }
    
    throw new Error("NeuronWriter: Query polling timed out after extensive retries.");
}

/**
 * Master orchestration function to get SEO data.
 * Handles the entire lifecycle: Create -> Poll -> Return.
 */
export async function getNeuronWriterAnalysis(
    keyword: string, 
    config: NeuronConfig, 
    onProgress?: (msg: string) => void
): Promise<NeuronAnalysisResult | null> {
    if (!config.enabled || !config.apiKey || !config.projectId) return null;

    try {
        onProgress?.("Starting NeuronWriter analysis (NLP)...");
        const queryId = await createNeuronQuery(keyword, config);
        
        onProgress?.("Waiting for NeuronWriter NLP terms (approx. 45s)...");
        const seoData = await pollNeuronQuery(queryId, config);
        
        onProgress?.("NeuronWriter analysis complete!");
        return seoData;
    } catch (err: any) {
        console.error("NeuronWriter Workflow Error:", err);
        // SOTA FIX: Do not fail the entire generation if Neuron fails, but notify user.
        // However, we throw here so the calling service knows it failed and can log it.
        throw err; 
    }
}

/**
 * Formats the raw NeuronWriter data into a high-impact prompt block for the AI.
 * STRICTLY SEPARATES H1 vs H2 TERMS.
 */
export function formatNeuronDataForPrompt(data: NeuronAnalysisResult | null): string {
    if (!data || !data.terms_txt) return "";
    
    return [
        '### NEURONWRITER NLP OPTIMIZATION DATA (MANDATORY COMPLIANCE)',
        'You MUST inject these exact terms naturally to boost the Content Score.',
        '',
        '**SECTION 1: META TITLE & H1 OPTIMIZATION**',
        `Use these terms specifically in the SEO Title and the main H1 Heading: ${data.terms_txt.title || "N/A"}`,
        '',
        '**SECTION 2: STRUCTURE & SUBHEADINGS (H2/H3)**',
        `Use these terms to craft your H2 and H3 subheadings: ${data.terms_txt.h2 || "N/A"}`,
        '',
        '**SECTION 3: BODY CONTENT (Basic & Extended)**',
        `Weave these terms naturally throughout the paragraphs:`,
        `Basic: ${data.terms_txt.content_basic || "N/A"}`,
        `Extended: ${data.terms_txt.content_extended || "N/A"}`,
        '',
        data.metrics?.word_count ? `**Target Word Count:** ~${data.metrics.word_count.target} (Ensure you hit the 2200-2800 range regardless)` : '',
        '\n'
    ].join('\n');
}