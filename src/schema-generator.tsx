
import { GeneratedContent, SiteInfo, ExpandedGeoTargeting, WpConfig } from './types';

// =================================================================
// 💎 PREMIUM SCHEMA.ORG MARKUP GENERATOR
// Optimized for AI Overviews, SGE, and SERP Dominance
// =================================================================

const ORGANIZATION_NAME = "Your Company Name";
const DEFAULT_AUTHOR_NAME = "Expert Author";

/**
 * Helper to generate Entity Mentions with Disambiguation (SOTA)
 * Tries to map keywords to Wikipedia URLs to lock in Knowledge Graph authority.
 */
function createEntityMentions(semanticKeywords: string[]) {
    return semanticKeywords.map(keyword => ({
        "@type": "Thing",
        "name": keyword,
        // SOTA TRICK: Heuristically pointing to Wikipedia increases entity confidence
        "sameAs": `https://en.wikipedia.org/wiki/${keyword.replace(/\s+/g, '_')}`
    }));
}

/**
 * Creates a Person schema with rich E-E-A-T signals
 */
function createPersonSchema(siteInfo: SiteInfo, primaryKeyword: string) {
    return {
        "@type": "Person",
        "@id": `${siteInfo?.authorUrl || ''}#person`,
        "name": siteInfo?.authorName || DEFAULT_AUTHOR_NAME,
        "url": siteInfo?.authorUrl || undefined,
        "sameAs": Array.isArray(siteInfo?.authorSameAs) && siteInfo.authorSameAs.length > 0 ? siteInfo.authorSameAs : undefined,
        "description": `Expert content creator specializing in ${primaryKeyword}`,
        "knowsAbout": [primaryKeyword],
    };
}

/**
 * Creates Organization schema with enhanced credibility signals
 */
function createOrganizationSchema(siteInfo: SiteInfo, wpConfig: WpConfig) {
    return {
        "@type": "Organization",
        "@id": `${wpConfig?.url || ''}#organization`,
        "name": siteInfo?.orgName || ORGANIZATION_NAME,
        "url": siteInfo?.orgUrl || wpConfig?.url,
        "logo": siteInfo?.logoUrl ? {
            "@type": "ImageObject",
            "@id": `${wpConfig?.url || ''}#logo`,
            "url": siteInfo.logoUrl,
            "width": 600,
            "height": 60,
        } : undefined,
        "sameAs": Array.isArray(siteInfo?.orgSameAs) && siteInfo.orgSameAs.length > 0 ? siteInfo.orgSameAs : undefined,
    };
}

/**
 * Creates LocalBusiness schema for geo-targeted content
 */
function createLocalBusinessSchema(siteInfo: SiteInfo, geoTargeting: ExpandedGeoTargeting, wpConfig: WpConfig) {
    if (!geoTargeting?.enabled) return null;

    return {
        "@type": "LocalBusiness",
        "@id": `${wpConfig?.url || ''}#localbusiness`,
        "name": siteInfo?.orgName || ORGANIZATION_NAME,
        "url": siteInfo?.orgUrl || wpConfig?.url,
        "image": siteInfo?.logoUrl,
        "address": {
            "@type": "PostalAddress",
            "addressLocality": geoTargeting?.location ?? '',
            "addressRegion": geoTargeting?.region ?? '',
            "postalCode": geoTargeting?.postalCode ?? '',
            "addressCountry": geoTargeting?.country ?? '',
        },
        "geo": {
            "@type": "GeoCoordinates",
            "addressCountry": geoTargeting?.country ?? ''
        },
        // 🚀 SOTA UPGRADE: Service Area Expansion
        "areaServed": [
            {
                "@type": "City",
                "name": geoTargeting.location
            },
            {
                "@type": "AdministrativeArea",
                "name": geoTargeting.region
            }
        ],
        // 🚀 SOTA UPGRADE: "Online" Signal for Hybrid Businesses
        "priceRange": "$$",
        "openingHoursSpecification": {
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": [
                "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"
            ],
            "opens": "09:00",
            "closes": "17:00"
        }
    };
}

/**
 * Creates premium NewsArticle or BlogPosting schema based on intent
 */
function createArticleSchema(
    content: GeneratedContent,
    wpConfig: WpConfig,
    orgSchema: any,
    personSchema: any,
    articleUrl: string
) {
    const today = new Date().toISOString();
    const contentHtml = content?.content ?? '';
    const textContent = contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = textContent.split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.ceil(wordCount / 200);
    
    // Extract all H2 headings for article structure
    const headings = [...contentHtml.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(m => m[1]);

    // SOTA UPGRADE: Dynamic Schema Switching
    const isNews = /news|update|launch|report|alert|review|202\d/i.test(content.title);
    const schemaType = isNews ? "NewsArticle" : "BlogPosting";

    const articleSchema: any = {
        "@type": schemaType,
        "@id": `${articleUrl}#article`,
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": articleUrl
        },
        "headline": content?.title ?? 'Untitled Article',
        "description": content?.metaDescription ?? '',
        
        // 🚀 SOTA UPGRADE: Explicit Concept Linking
        "about": {
            "@type": "Thing",
            "name": content?.primaryKeyword,
            "sameAs": `https://en.wikipedia.org/wiki/${(content?.primaryKeyword || '').replace(/\s+/g, '_')}`
        },
        "mentions": createEntityMentions(content?.semanticKeywords || []),

        "image": (content?.imageDetails ?? [])
            .filter(img => img?.generatedImageSrc)
            .map(img => ({
                "@type": "ImageObject",
                "url": img.generatedImageSrc,
                "caption": img.altText
            })),
        "datePublished": today,
        "dateModified": today,
        "author": personSchema,
        "publisher": orgSchema,
        "keywords": [content?.primaryKeyword ?? '', ...(content?.semanticKeywords ?? [])].filter(Boolean).join(", "),
        "articleSection": content?.primaryKeyword ?? '',
        "wordCount": wordCount,
        "timeRequired": `PT${readingTimeMinutes}M`,
        "inLanguage": "en-US",
        "isAccessibleForFree": true,
        "speakable": {
            "@type": "SpeakableSpecification",
            "cssSelector": ["h1", "h2", "h3"]
        },
    };

    // Add article sections for better structure
    if (headings.length > 0) {
        articleSchema.hasPart = headings.map((heading, index) => ({
            "@type": "WebPageElement",
            "@id": `${articleUrl}#section-${index + 1}`,
            "name": heading,
        }));
    }

    // SOTA E-E-A-T UPGRADE: Add formal citations for Trustworthiness
    if (Array.isArray(content.references) && content.references.length > 0) {
        articleSchema.citation = content.references.map(ref => ({
            "@type": "CreativeWork",
            "name": ref.title,
            "url": ref.url,
            "author": {
                "@type": "Organization",
                "name": ref.source
            }
        }));
    }

    return articleSchema;
}

/**
 * Creates WebSite schema with SearchAction for AI crawlers
 */
function createWebSiteSchema(wpConfig: WpConfig, orgSchema: any) {
    const baseUrl = wpConfig?.url || '';
    return {
        "@type": "WebSite",
        "@id": `${baseUrl}#website`,
        "url": baseUrl,
        "name": orgSchema?.name,
        "publisher": {
            "@id": `${baseUrl}#organization`
        },
        "potentialAction": {
            "@type": "SearchAction",
            "target": {
                "@type": "EntryPoint",
                "urlTemplate": `${baseUrl}/?s={search_term_string}`
            },
            "query-input": "required name=search_term_string"
        }
    };
}

/**
 * Creates BreadcrumbList for enhanced navigation and SERP display
 */
function createBreadcrumbSchema(content: GeneratedContent, wpConfig: WpConfig, articleUrl: string) {
    const primaryKeyword = content?.primaryKeyword ?? 'Category';
    const baseUrl = wpConfig?.url || '';
    return {
        "@type": "BreadcrumbList",
        "@id": `${articleUrl}#breadcrumb`,
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": baseUrl
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": primaryKeyword,
                "item": `${baseUrl}/category/${primaryKeyword.toLowerCase().replace(/\s+/g, '-')}`
            },
            {
                "@type": "ListItem",
                "position": 3,
                "name": content?.title ?? 'Current Page',
                "item": articleUrl
            }
        ]
    };
}

/**
 * Creates FAQPage schema from structured data
 */
function createFaqSchema(faqData: { question: string, answer: string }[]) {
    if (!Array.isArray(faqData) || faqData.length === 0) return null;
    
    const mainEntity = faqData
        .filter(faq => faq?.question && faq?.answer)
        .map(faq => ({
            "@type": "Question",
            "name": faq.question,
            "acceptedAnswer": {
                "@type": "Answer",
                "text": faq.answer,
            },
        }));

    if (mainEntity.length === 0) return null;

    return {
        "@type": "FAQPage",
        "mainEntity": mainEntity,
    };
}

/**
 * Creates HowTo schema for instructional content
 */
function createHowToSchema(content: GeneratedContent, articleUrl: string) {
    const contentHtml = content?.content ?? '';
    const headings = [...contentHtml.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(m => m[1]);
    
    // Check if content is instructional
    const hasSteps = contentHtml.match(/<ol>[\s\S]*?<\/ol>/) || 
                     headings.some(h => h.toLowerCase().includes('step') || 
                                       h.toLowerCase().includes('how to'));
    
    if (!hasSteps || headings.length < 3) return null;

    const textContent = contentHtml.replace(/<[^>]+>/g, ' ').trim();
    const wordCount = textContent.split(/\s+/).filter(Boolean).length;
    const readingTimeMinutes = Math.ceil(wordCount / 200);

    return {
        "@type": "HowTo",
        "@id": `${articleUrl}#howto`,
        "name": content?.title ?? 'How-To Guide',
        "description": content?.metaDescription ?? '',
        "totalTime": `PT${readingTimeMinutes}M`,
        "step": headings.slice(0, 8).map((heading, index) => ({
            "@type": "HowToStep",
            "position": index + 1,
            "name": heading,
            "text": heading,
            "url": `${articleUrl}#section-${index + 1}`
        }))
    };
}

/**
 * Creates VideoObject schemas for embedded YouTube videos
 */
function createVideoObjectSchemas(content: GeneratedContent, articleUrl: string) {
    const schemas: any[] = [];
    const contentHtml = content?.content ?? '';
    const videoMatches = [...contentHtml.matchAll(/youtube\.com\/embed\/([^"?]+)/g)];
    
    videoMatches.forEach((match, index) => {
        const videoId = match[1];
        schemas.push({
            "@type": "VideoObject",
            "@id": `${articleUrl}#video-${index + 1}`,
            "name": `Video: ${content?.title || 'Related Video'} - Part ${index + 1}`,
            "description": content?.metaDescription ?? '',
            "thumbnailUrl": `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            "uploadDate": new Date().toISOString(),
            "contentUrl": `https://www.youtube.com/watch?v=${videoId}`,
            "embedUrl": `https://www.youtube.com/embed/${videoId}`,
            "inLanguage": "en-US"
        });
    });

    return schemas.length > 0 ? schemas : null;
}

/**
 * Main schema generation function - creates comprehensive @graph
 */
export function generateFullSchema(
    content: GeneratedContent,
    wpConfig: WpConfig,
    siteInfo: SiteInfo,
    faqData?: { question: string, answer: string }[],
    geoTargeting?: ExpandedGeoTargeting
): object {
    const articleUrl = `${(wpConfig?.url || '').replace(/\/+$/, '')}/${content?.slug || ''}`;
    const schemas: any[] = [];
    
    // 1. Organization (Publisher)
    const organizationSchema = createOrganizationSchema(siteInfo, wpConfig);
    schemas.push(organizationSchema);
    
    // 2. Person (Author)
    const personSchema = createPersonSchema(siteInfo, content?.primaryKeyword || '');
    schemas.push(personSchema);
    
    // 3. WebSite
    const websiteSchema = createWebSiteSchema(wpConfig, organizationSchema);
    schemas.push(websiteSchema);
    
    // 4. NewsArticle (Primary Content)
    const articleSchema = createArticleSchema(content, wpConfig, organizationSchema, personSchema, articleUrl);
    
    // Add geo-targeting if enabled
    if (geoTargeting?.enabled && geoTargeting.location) {
        articleSchema.contentLocation = {
            "@type": "Place",
            "name": geoTargeting.location,
            "address": {
                "@type": "PostalAddress",
                "addressLocality": geoTargeting.location ?? '',
                "addressRegion": geoTargeting.region ?? '',
                "addressCountry": geoTargeting.country ?? '',
                "postalCode": geoTargeting.postalCode ?? ''
            }
        };
        articleSchema.spatialCoverage = {
            "@type": "Place",
            "name": geoTargeting.location
        };
        
        // Add LocalBusiness schema for geo-targeted content
        const localBusinessSchema = createLocalBusinessSchema(siteInfo, geoTargeting, wpConfig);
        if (localBusinessSchema) schemas.push(localBusinessSchema);
    }
    
    schemas.push(articleSchema);
    
    // 5. BreadcrumbList
    const breadcrumbSchema = createBreadcrumbSchema(content, wpConfig, articleUrl);
    schemas.push(breadcrumbSchema);
    
    // 6. FAQPage
    if (faqData && faqData.length > 0) {
        const faqSchema = createFaqSchema(faqData);
        if (faqSchema) schemas.push(faqSchema);
    }
    
    // 7. HowTo (if applicable)
    const howToSchema = createHowToSchema(content, articleUrl);
    if (howToSchema) schemas.push(howToSchema);
    
    // 8. VideoObject schemas
    const videoSchemas = createVideoObjectSchemas(content, articleUrl);
    if (videoSchemas) schemas.push(...videoSchemas);

    return {
        "@context": "https://schema.org",
        "@graph": schemas,
    };
}

/**
 * Wraps schema in proper script tags for WordPress
 */
export function generateSchemaMarkup(schemaObject: object): string {
    if (!schemaObject || !Object.prototype.hasOwnProperty.call(schemaObject, '@graph') || 
        (schemaObject as any)['@graph'].length === 0) {
        return '';
    }
    
    const schemaScript = `<script type="application/ld+json">\n${JSON.stringify(schemaObject, null, 2)}\n</script>`;
    
    // ════════════════════════════════════════════════════════════════════════════════
    // CRITICAL: WordPress REST API strips <script> tags by default for security.
    // The ONLY reliable method is wrapping in Gutenberg's Custom HTML block.
    // This preserves the schema and prevents it from being stripped or displayed as text.
    // ════════════════════════════════════════════════════════════════════════════════
    return `\n\n<!-- wp:html -->\n${schemaScript}\n<!-- /wp:html -->\n\n`;
}
