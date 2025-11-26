
import React from "react";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { NeuronAnalysisResult } from "./neuronwriter";

export interface NeuronConfig {
    apiKey: string;
    projectId: string;
    enabled: boolean;
}

export type SitemapPage = {
    id: string;
    title: string;
    slug: string;
    lastMod: string | null;
    wordCount: number | null;
    crawledContent: string | null;
    healthScore: number | null;
    updatePriority: string | null;
    justification: string | null;
    daysOld: number | null;
    isStale: boolean;
    publishedState: string;
    status: 'idle' | 'analyzing' | 'analyzed' | 'error';
    analysis?: {
        critique: string;
        contentGaps: string[];
        seoIssues: string[];
        improvementPlan: string;
    } | null;
};

export type GeneratedContent = {
    title: string;
    slug: string;
    metaDescription: string;
    primaryKeyword: string;
    semanticKeywords: string[];
    content: string;
    imageDetails: {
        prompt: string;
        altText: string;
        title: string;
        placeholder: string;
        generatedImageSrc?: string;
    }[];
    strategy: {
        targetAudience: string;
        searchIntent: string;
        competitorAnalysis: string;
        contentAngle: string;
    };
    jsonLdSchema: object;
    socialMediaCopy: {
        twitter: string;
        linkedIn: string;
    };
    faqSection?: { question: string, answer: string }[];
    keyTakeaways?: string[];
    outline?: string[];
    serpData?: any[] | null;
    references?: { title: string, url: string, source: string, year: number }[];
    neuronAnalysis?: NeuronAnalysisResult | null;
    surgicalSnippets?: {
        introHtml: string;
        keyTakeawaysHtml: string;
        comparisonTableHtml: string;
        faqHtml: string;
    };
};

export interface SiteInfo {
    orgName: string;
    orgUrl: string;
    logoUrl: string;
    orgSameAs: string[];
    authorName: string;
    authorUrl: string;
    authorSameAs: string[];
}

export interface ExpandedGeoTargeting {
    enabled: boolean;
    location: string;
    region: string;
    country: string;
    postalCode: string;
}

export type ContentItem = {
    id: string;
    title: string;
    type: 'pillar' | 'cluster' | 'standard' | 'link-optimizer' | 'refresh';
    status: 'idle' | 'generating' | 'done' | 'error';
    statusText: string;
    generatedContent: GeneratedContent | null;
    crawledContent: string | null;
    originalUrl?: string;
    analysis?: SitemapPage['analysis'];
};

export type SeoCheck = {
    id: string;
    valid: boolean;
    text: string;
    value: string | number;
    category: 'Meta' | 'Content' | 'Accessibility' | 'Trust & E-E-A-T';
    priority: 'High' | 'Medium' | 'Low';
    advice: string;
};

export type ApiClients = {
    gemini: GoogleGenAI | null;
    openai: OpenAI | null;
    anthropic: Anthropic | null;
    openrouter: OpenAI | null;
    groq: OpenAI | null;
};

export type WpConfig = {
    url: string;
    username: string;
};

export interface GapAnalysisSuggestion {
    keyword: string;
    searchIntent: 'Informational' | 'Commercial' | 'Transactional';
    rationale: string;
    trendScore: number;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    monthlyVolume: string;
}

export interface GenerationContext {
    dispatch: React.Dispatch<any>;
    existingPages: SitemapPage[];
    siteInfo: SiteInfo;
    wpConfig: WpConfig;
    geoTargeting: ExpandedGeoTargeting;
    serperApiKey: string;
    apiKeyStatus: Record<string, 'idle' | 'validating' | 'valid' | 'invalid'>;
    apiClients: ApiClients;
    selectedModel: string;
    openrouterModels: string[];
    selectedGroqModel: string;
    neuronConfig: NeuronConfig;
}
