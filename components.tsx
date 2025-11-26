
import React, { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react';
import { ContentItem, SeoCheck, ExpandedGeoTargeting, WpConfig, SitemapPage, ApiClients, NeuronConfig } from './types';
import { calculateFleschReadability, getReadabilityVerdict, escapeRegExp } from './contentUtils';
import { extractSlugFromUrl, parseJsonWithAiRepair, processConcurrently } from './utils';
import { MIN_INTERNAL_LINKS, TARGET_MAX_WORDS, TARGET_MIN_WORDS } from './constants';
import { callAI } from './services';
import ReactQuill from 'react-quill';

export const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
);

export const XIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
);

const SetupIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;
const StrategyIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>;
const ReviewIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;

export const SidebarNav = memo(({ activeView, onNavClick }: { activeView: string; onNavClick: (view: string) => void; }) => {
    const navItems = [
        { id: 'setup', name: 'Configuration', icon: <SetupIcon /> },
        { id: 'strategy', name: 'Content Strategy', icon: <StrategyIcon /> },
        { id: 'review', name: 'Review & Export', icon: <ReviewIcon /> }
    ];
    return (
        <nav aria-label="Main navigation">
            <div className="sidebar-nav">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                        onClick={() => onNavClick(item.id)}
                        aria-current={activeView === item.id}
                    >
                        {item.icon}
                        <span className="nav-item-name">{item.name}</span>
                    </button>
                ))}
            </div>
        </nav>
    );
});

interface ApiKeyInputProps {
    provider: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    status: 'idle' | 'validating' | 'valid' | 'invalid';
    name?: string;
    placeholder?: string;
    isTextArea?: boolean;
    isEditing: boolean;
    onEdit: () => void;
    type?: 'text' | 'password';
}
export const ApiKeyInput = memo(({ provider, value, onChange, status, name, placeholder, isTextArea, isEditing, onEdit, type = 'password' }: ApiKeyInputProps) => {
    const InputComponent = isTextArea ? 'textarea' : 'input';

    if (status === 'valid' && !isEditing) {
        return (
            <div className="api-key-group">
                <input type="text" readOnly value={`**** **** **** ${value.slice(-4)}`} disabled style={{opacity: 0.7}} />
                <button onClick={onEdit} className="btn-edit-key" style={{position: 'absolute', right: '40px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600'}} aria-label={`Edit ${provider} API Key`}>EDIT</button>
            </div>
        );
    }

    const commonProps = {
        name: name || `${provider}ApiKey`,
        value: value,
        onChange: onChange,
        placeholder: placeholder || `Enter your ${provider.charAt(0).toUpperCase() + provider.slice(1)} API Key`,
        'aria-invalid': status === 'invalid',
        'aria-describedby': `${provider}-status`,
        ...(isTextArea ? { rows: 4 } : { type: type })
    };

    return (
        <div className="api-key-group">
            <InputComponent {...commonProps} />
            <div className="key-status-icon" id={`${provider}-status`} role="status">
                {status === 'validating' && <div className="key-status-spinner" aria-label="Validating key"></div>}
                {status === 'valid' && <span className="success"><CheckIcon /></span>}
                {status === 'invalid' && <span className="error"><XIcon /></span>}
            </div>
        </div>
    );
});

const ScoreGauge = ({ score, size = 80 }: { score: number; size?: number }) => {
    const radius = size / 2 - 5;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    let strokeColor = '#10B981';
    if (score < 85) strokeColor = '#F59E0B'; 
    if (score < 50) strokeColor = '#EF4444';

    return (
        <div className="score-gauge" style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg className="score-gauge-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{transform: 'rotate(-90deg)'}}>
                <circle className="gauge-bg" cx={size/2} cy={size/2} r={radius} stroke="rgba(255,255,255,0.05)" strokeWidth="6" fill="none" />
                <circle className="gauge-fg" cx={size/2} cy={size/2} r={radius} stroke={strokeColor} strokeWidth="6" fill="none" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{transition: 'stroke-dashoffset 1s ease'}} />
            </svg>
            <span className="score-gauge-text" style={{ color: strokeColor, position: 'absolute', fontSize: size * 0.28, fontWeight: '800', letterSpacing: '-1px' }}>{score}</span>
        </div>
    );
};

interface RankGuardianProps {
    item: ContentItem;
    editedSeo: { title: string; metaDescription: string; slug: string };
    editedContent: string;
    onSeoChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onUrlChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRegenerate: (field: 'title' | 'meta') => void;
    isRegenerating: { title: boolean; meta: boolean };
    isUpdate: boolean;
    geoTargeting: ExpandedGeoTargeting;
}

export const RankGuardian = memo(({ item, editedSeo, editedContent, onSeoChange, onUrlChange, onRegenerate, isRegenerating, isUpdate, geoTargeting }: RankGuardianProps) => {
    if (!item.generatedContent) return <div className="guardian-card"><h4>No Analysis Data</h4></div>;

    const { title, metaDescription, slug } = editedSeo;
    const { primaryKeyword = '', semanticKeywords = [], serpData } = item.generatedContent;

    const analysis = useMemo(() => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = editedContent || '';
        const textContent = tempDiv.textContent || '';
        const wordCount = textContent.trim().split(/\s+/).length;
        const keywordLower = (primaryKeyword || '').toLowerCase();
        const first100Words = (tempDiv.textContent || '').substring(0, 800).split(/\s+/).slice(0, 100).join(' ').toLowerCase();
        const keywordInFirst100 = !!keywordLower && first100Words.includes(keywordLower);
        
        const contentAnalysis = {
            wordCount,
            readabilityScore: calculateFleschReadability(textContent),
            keywordDensity: keywordLower ? (textContent.toLowerCase().match(new RegExp(escapeRegExp(keywordLower), 'g')) || []).length : 0,
            linkCount: tempDiv.getElementsByTagName('a').length,
            tableCount: tempDiv.getElementsByTagName('table').length,
            listCount: tempDiv.querySelectorAll('ul, ol').length,
        };

        // SOTA RANK GUARDIAN CHECKS - STRICT ENFORCEMENT
        const checks: SeoCheck[] = [
            { 
                id: 'titleLength', 
                valid: title.length >= 50 && title.length <= 60, 
                value: title.length, 
                text: 'Title Length (50-60)', 
                category: 'Meta', 
                priority: 'High', 
                advice: 'Strictly 50-60 characters for optimal CTR.' 
            },
            { 
                id: 'metaLength', 
                valid: metaDescription.length >= 135 && metaDescription.length <= 150, 
                value: metaDescription.length, 
                text: 'Meta Description (135-150)', 
                category: 'Meta', 
                priority: 'High', 
                advice: 'Strictly 135-150 characters required.' 
            },
            { 
                id: 'wordCount', 
                valid: wordCount >= 2200 && wordCount <= 2800, 
                value: wordCount, 
                text: `Word Count (2200-2800)`, 
                category: 'Content', 
                priority: 'High', 
                advice: `Must be between 2200 and 2800 words.` 
            },
            { 
                id: 'keywordInFirstP', 
                valid: keywordInFirst100, 
                value: keywordInFirst100 ? 'Yes' : 'No', 
                text: 'Keyword in First 100 Words', 
                category: 'Content', 
                priority: 'High', 
                advice: 'Primary keyword must appear immediately.' 
            },
            { 
                id: 'verificationFooter', 
                valid: editedContent.includes('verification-footer-sota'), 
                value: editedContent.includes('verification-footer-sota') ? 'Yes' : 'No', 
                text: 'Scientific Verification', 
                category: 'Trust & E-E-A-T', 
                priority: 'High', 
                advice: 'Content must have the scientific verification footer.' 
            },
             { 
                id: 'links', 
                valid: contentAnalysis.linkCount >= 6 && contentAnalysis.linkCount <= 12, 
                value: contentAnalysis.linkCount, 
                text: `Internal Links (6-12)`, 
                category: 'Content', 
                priority: 'Medium', 
                advice: 'Must have 6-12 high-quality internal links.' 
            },
        ];
        
        return { contentAnalysis, checks };
    }, [title, metaDescription, primaryKeyword, editedContent]);
    
    const { contentAnalysis, checks } = analysis;
    const readabilityVerdict = getReadabilityVerdict(contentAnalysis.readabilityScore);

    const scores = useMemo(() => {
        const validChecks = checks.filter(c => c.valid).length;
        const seoScore = Math.round((validChecks / checks.length) * 100);
        const overallScore = Math.round(seoScore * 0.6 + contentAnalysis.readabilityScore * 0.4);
        return { seoScore, overallScore };
    }, [checks, contentAnalysis.readabilityScore]);
    
    const actionItems = checks.filter(c => !c.valid).sort((a, b) => (a.priority === 'High' ? -1 : 1));

    return (
        <div className="rank-guardian-reloaded">
             <div className="guardian-header">
                <div className="guardian-main-score">
                    <ScoreGauge score={scores.overallScore} size={120} />
                    <div className="main-score-text">
                        <h4 style={{color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '0.9rem'}}>Overall Optimization</h4>
                        <p style={{fontSize: '2.2rem', fontWeight: '800', color: 'white', lineHeight: 1}}>
                            {scores.overallScore >= 85 ? 'SOTA Ready' : 'Optimization Needed'}
                        </p>
                    </div>
                </div>
                <div style={{display: 'flex', gap: '2rem', marginRight: '2rem'}}>
                    <div style={{textAlign: 'center'}}>
                        <div style={{fontSize: '1.5rem', fontWeight: '700', color: scores.seoScore >= 85 ? '#10B981' : '#F59E0B'}}>{scores.seoScore}</div>
                        <div style={{fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: '600'}}>SEO Score</div>
                    </div>
                     <div style={{textAlign: 'center'}}>
                        <div style={{fontSize: '1.5rem', fontWeight: '700', color: contentAnalysis.readabilityScore >= 85 ? '#10B981' : '#F59E0B'}}>{contentAnalysis.readabilityScore}</div>
                        <div style={{fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748B', fontWeight: '600'}}>Readability</div>
                    </div>
                </div>
            </div>

            <div className="guardian-grid">
                <div className="guardian-card">
                     <h4>Metadata & SERP</h4>
                     <div className="seo-inputs">
                        <div className="form-group">
                            <label>SEO Title (50-60 chars)</label>
                            <input type="text" value={title} onChange={onSeoChange} name="title" style={{borderColor: (title.length >= 50 && title.length <= 60) ? '#10B981' : '#DC2626'}} />
                            <div style={{display: 'flex', justifyContent: 'space-between', marginTop: '4px'}}>
                                <span style={{fontSize: '0.75rem', color: (title.length >= 50 && title.length <= 60) ? '#10B981' : '#DC2626'}}>{title.length} / 60</span>
                                <button className="btn-regenerate" onClick={() => onRegenerate('title')} style={{background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer'}}>Regenerate</button>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Meta Description (135-150 chars)</label>
                            <textarea value={metaDescription} onChange={onSeoChange} name="metaDescription" rows={3} style={{borderColor: (metaDescription.length >= 135 && metaDescription.length <= 150) ? '#10B981' : '#DC2626'}}></textarea>
                             <div style={{display: 'flex', justifyContent: 'space-between', marginTop: '4px'}}>
                                <span style={{fontSize: '0.75rem', color: (metaDescription.length >= 135 && metaDescription.length <= 150) ? '#10B981' : '#DC2626'}}>{metaDescription.length} / 150</span>
                                <button className="btn-regenerate" onClick={() => onRegenerate('meta')} style={{background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer'}}>Regenerate</button>
                            </div>
                        </div>
                    </div>
                </div>
                
                 <div className="guardian-card">
                    <h4>Priority Actions</h4>
                     {actionItems.length === 0 ? (
                        <div style={{textAlign: 'center', padding: '2rem', color: '#10B981'}}>
                            <span style={{fontSize: '2.5rem'}}>🚀</span>
                            <p style={{fontWeight: '700', marginTop: '1rem'}}>All SOTA Checks Passed!</p>
                        </div>
                    ) : (
                        <ul className="action-item-list" style={{listStyle: 'none', padding: 0}}>
                            {actionItems.map(item => (
                                <li key={item.id} className={`priority-${item.priority}`}>
                                    <h5 style={{color: 'white', fontSize: '0.9rem', fontWeight: '700', marginBottom: '0.2rem'}}>{item.text}</h5>
                                    <p style={{color: '#94A3B8', fontSize: '0.8rem', margin: 0}}>{item.advice}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                
                <div className="guardian-card full-width">
                    <h4>Deep Analysis Checklist</h4>
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem'}}>
                       {checks.map(check => (
                           <div key={check.id} style={{display: 'flex', gap: '0.8rem', alignItems: 'center', padding: '0.8rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-subtle)'}}>
                                <div style={{color: check.valid ? '#10B981' : '#DC2626', fontSize: '1.2rem'}}>{check.valid ? <CheckIcon /> : <XIcon />}</div>
                                <div>
                                    <div style={{color: 'white', fontWeight: '600', fontSize: '0.85rem'}}>{check.text}</div>
                                    <div style={{color: '#64748B', fontSize: '0.75rem'}}>{check.valid ? 'Passed' : check.advice.substring(0, 40) + '...'}</div>
                                </div>
                           </div>
                       ))}
                    </div>
                </div>
            </div>
        </div>
    );
});

export const SkeletonLoader = ({ rows = 5, columns = 5 }: { rows?: number, columns?: number }) => (
    <>
        {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
                {Array.from({ length: columns }).map((_, j) => (
                    <td key={j}><div style={{height: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', animation: 'pulse 1.5s infinite'}}></div></td>
                ))}
            </tr>
        ))}
    </>
);

export const Confetti = () => {
    const [pieces, setPieces] = useState<React.ReactElement[]>([]);
    useEffect(() => {
        const newPieces = Array.from({ length: 100 }).map((_, i) => {
            const style = {
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                backgroundColor: `hsl(${Math.random() * 360}, 70%, 50%)`,
                transform: `rotate(${Math.random() * 360}deg)`,
                position: 'fixed' as const,
                top: '-10px',
                width: '8px',
                height: '8px',
                zIndex: 2000,
                animation: 'fall 3s linear forwards'
            };
            return <div key={i} className="confetti" style={style}></div>;
        });
        setPieces(newPieces);
    }, []);
    return <><style>{`@keyframes fall { to { top: 100vh; transform: rotate(720deg); } }`}</style><div className="confetti-container" aria-hidden="true">{pieces}</div></>;
};

interface ReviewModalProps {
    item: ContentItem;
    onClose: () => void;
    onSaveChanges: (itemId: string, updatedSeo: { title: string; metaDescription: string; slug: string }, updatedContent: string) => void;
    wpConfig: WpConfig;
    wpPassword: string;
    onPublishSuccess: (originalUrl: string) => void;
    publishItem: (itemToPublish: ContentItem, currentWpPassword: string, status: 'publish' | 'draft') => Promise<{ success: boolean; message: React.ReactNode; link?: string }>;
    callAI: (promptKey: any, promptArgs: any[], responseFormat?: 'json' | 'html', useGrounding?: boolean) => Promise<string>;
    geoTargeting: ExpandedGeoTargeting;
    neuronConfig: NeuronConfig;
}

export const ReviewModal = ({ item, onClose, onSaveChanges, wpConfig, wpPassword, onPublishSuccess, publishItem, callAI, geoTargeting, neuronConfig }: ReviewModalProps) => {
    if (!item || !item.generatedContent) return null;
    const [activeTab, setActiveTab] = useState('Live Preview');
    const [editedSeo, setEditedSeo] = useState({ title: '', metaDescription: '', slug: '' });
    const [editedContent, setEditedContent] = useState('');
    const [wpPublishStatus, setWpPublishStatus] = useState('idle');
    const [wpPublishMessage, setWpPublishMessage] = useState<React.ReactNode>('');
    const [publishAction, setPublishAction] = useState<'publish' | 'draft'>('publish');
    const [isRegenerating, setIsRegenerating] = useState({ title: false, meta: false });
    const [neuronTermFilter, setNeuronTermFilter] = useState<'all' | 'used' | 'unused'>('all');
    const [publishedLink, setPublishedLink] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (item && item.generatedContent) {
            const isUpdate = !!item.originalUrl;
            const fullUrl = isUpdate ? item.originalUrl! : `${wpConfig.url.replace(/\/+$/, '')}/${item.generatedContent.slug}`;
            setEditedSeo({ title: item.generatedContent.title, metaDescription: item.generatedContent.metaDescription, slug: fullUrl });
            setEditedContent(item.generatedContent.content);
            setActiveTab('Live Preview');
        }
    }, [item]);

    const handleSeoChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setEditedSeo(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleRegenerateSeo = async (field: 'title' | 'meta') => {
        if (!item.generatedContent) return;
        setIsRegenerating(prev => ({ ...prev, [field]: true }));
        try {
            const { primaryKeyword, strategy, serpData } = item.generatedContent;
            const summary = editedContent.replace(/<[^>]+>/g, ' ').substring(0, 500);
            // SOTA FIX: Ensure serpData is an array before mapping to avoid crashes
            const competitorTitles = (serpData || []).map((d: any) => d.title).slice(0, 5);
            const location = geoTargeting.enabled ? geoTargeting.location : null;
            const responseText = await callAI('seo_metadata_generator', [primaryKeyword, summary, strategy.targetAudience, competitorTitles, location], 'json');
            const aiRepairer = (brokenText: string) => callAI('json_repair', [brokenText], 'json');
            const { seoTitle, metaDescription } = await parseJsonWithAiRepair(responseText, aiRepairer);
            if (field === 'title' && seoTitle) setEditedSeo(prev => ({ ...prev, title: seoTitle }));
            if (field === 'meta' && metaDescription) setEditedSeo(prev => ({ ...prev, metaDescription: metaDescription }));
        } catch (error) {
            console.error(error);
        } finally {
            setIsRegenerating(prev => ({ ...prev, [field]: false }));
        }
    };

    const handlePublishToWordPress = async () => {
        if (!wpConfig.url || !wpConfig.username || !wpPassword) {
            setWpPublishStatus('error');
            setWpPublishMessage('Configure WordPress credentials first.');
            return;
        }
        setWpPublishStatus('publishing');
        setPublishedLink(undefined);
        const itemWithEdits = { ...item, generatedContent: { ...item.generatedContent!, title: editedSeo.title, metaDescription: editedSeo.metaDescription, slug: extractSlugFromUrl(editedSeo.slug), content: editedContent } };
        const result = await publishItem(itemWithEdits, wpPassword, item.originalUrl ? 'publish' : publishAction);
        setWpPublishStatus(result.success ? 'success' : 'error');
        setWpPublishMessage(result.message);
        if (result.success && result.link) setPublishedLink(result.link);
        if (result.success && item.originalUrl) onPublishSuccess(item.originalUrl);
    };

    const TABS = ['Live Preview', 'Editor', 'Assets', 'Rank Guardian', 'Raw JSON'];
    if (item.generatedContent?.neuronAnalysis || neuronConfig?.enabled) TABS.splice(3, 0, 'Neuron NLP');

    // SOTA Neuron Helper
    const neuronAnalysisView = useMemo(() => {
        const na = item.generatedContent?.neuronAnalysis?.terms_txt;
        if (!na) return null;
        const checkTerms = (termString: string | undefined) => {
            if (!termString) return [];
            const terms = termString.split(/,|\n/).map(t => t.trim()).filter(t => t.length > 0);
            return terms.map(term => ({ term, exists: editedContent.toLowerCase().includes(term.toLowerCase()) }));
        };
        
        const h1 = checkTerms(na.h1 || na.title);
        const h2 = checkTerms(na.h2);
        const basic = checkTerms(na.content_basic);
        const extended = checkTerms(na.content_extended);
        
        const filterTerms = (terms: any[]) => {
            if (neuronTermFilter === 'used') return terms.filter(t => t.exists);
            if (neuronTermFilter === 'unused') return terms.filter(t => !t.exists);
            return terms;
        };

        return { 
            h1: filterTerms(h1), 
            h2: filterTerms(h2), 
            basic: filterTerms(basic), 
            extended: filterTerms(extended),
            stats: {
                h1: { total: h1.length, used: h1.filter(t => t.exists).length },
                h2: { total: h2.length, used: h2.filter(t => t.exists).length },
                basic: { total: basic.length, used: basic.filter(t => t.exists).length },
                extended: { total: extended.length, used: extended.filter(t => t.exists).length }
            }
        };
    }, [item.generatedContent?.neuronAnalysis, editedContent, neuronTermFilter]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 style={{color: 'white', fontSize: '1rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em'}}>{item.title}</h3>
                    <button className="modal-close-btn" onClick={onClose} style={{background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.5rem', cursor: 'pointer'}}>&times;</button>
                </div>
                <div className="review-tabs">
                    {TABS.map(tab => (
                        <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                    ))}
                </div>
                <div className="tab-content">
                    {activeTab === 'Live Preview' && <div className="live-preview" dangerouslySetInnerHTML={{ __html: editedContent }}></div>}
                    {activeTab === 'Editor' && <div className="editor-tab-container"><ReactQuill theme="snow" value={editedContent} onChange={setEditedContent} style={{height: '100%'}} /></div>}
                    {activeTab === 'Assets' && (
                        <div className="assets-tab-container" style={{padding: '2rem', overflowY: 'auto', height: '100%', background: '#050507'}}>
                            <div className="image-assets-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '2rem'}}>
                                {item.generatedContent.imageDetails.map((image, index) => (
                                    image.generatedImageSrc && <div key={index} className="image-asset-card">
                                        <img src={image.generatedImageSrc} alt={image.altText} style={{width: '100%', height: '200px', objectFit: 'cover'}} />
                                        <div style={{padding: '1rem'}}><p style={{color: '#94A3B8', fontSize: '0.8rem'}}>{image.prompt}</p></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {activeTab === 'Neuron NLP' && (
                        <div className="rank-guardian-container">
                             <div className="neuron-filter-bar">
                                <h4 style={{color: '#E2E8F0', margin: '0 0 0 1rem'}}>NEURONWRITER INTELLIGENCE</h4>
                                <div style={{display: 'flex', gap: '0.5rem', marginRight: '1rem'}}>
                                    {[
                                        {id: 'all', label: 'All Terms'}, 
                                        {id: 'used', label: '✅ Used'}, 
                                        {id: 'unused', label: '⚠️ Unused'}
                                    ].map(f => (
                                        <button 
                                            key={f.id} 
                                            onClick={() => setNeuronTermFilter(f.id as any)} 
                                            className={`btn ${neuronTermFilter === f.id ? 'btn' : 'btn-secondary'}`}
                                            style={{
                                                border: neuronTermFilter === f.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                                                fontWeight: 700,
                                                fontSize: '0.85rem'
                                            }}
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {neuronAnalysisView ? (
                                <div className="guardian-grid" style={{marginTop: '1rem', maxWidth: '1600px', margin: '0 auto'}}>
                                    <div className="guardian-card">
                                        <div className="neuron-section-title">META & H1 TERMS ({neuronAnalysisView.stats.h1.used}/{neuronAnalysisView.stats.h1.total})</div>
                                        <div className="nlp-term-cloud">{neuronAnalysisView.h1.map((t, i) => <span key={i} className={`badge ${t.exists ? 'pillar' : 'standard'}`}>{t.term}</span>)}</div>
                                    </div>
                                    <div className="guardian-card">
                                        <div className="neuron-section-title">SUBHEADINGS (H2/H3) ({neuronAnalysisView.stats.h2.used}/{neuronAnalysisView.stats.h2.total})</div>
                                        <div className="nlp-term-cloud">{neuronAnalysisView.h2.map((t, i) => <span key={i} className={`badge ${t.exists ? 'pillar' : 'standard'}`}>{t.term}</span>)}</div>
                                    </div>
                                    <div className="guardian-card full-width">
                                        <div className="neuron-section-title">BASIC CONTENT TERMS ({neuronAnalysisView.stats.basic.used}/{neuronAnalysisView.stats.basic.total})</div>
                                        <div className="nlp-term-cloud">{neuronAnalysisView.basic.map((t, i) => <span key={i} className={`badge ${t.exists ? 'pillar' : 'standard'}`}>{t.term}</span>)}</div>
                                    </div>
                                     <div className="guardian-card full-width">
                                        <div className="neuron-section-title">EXTENDED CONTENT TERMS ({neuronAnalysisView.stats.extended.used}/{neuronAnalysisView.stats.extended.total})</div>
                                        <div className="nlp-term-cloud">{neuronAnalysisView.extended.map((t, i) => <span key={i} className={`badge ${t.exists ? 'pillar' : 'standard'}`}>{t.term}</span>)}</div>
                                    </div>
                                </div>
                            ) : <div style={{padding: '3rem', textAlign: 'center', color: '#64748B'}}>No NeuronWriter data available. Ensure you have enabled the integration in Setup.</div>}
                        </div>
                    )}
                    {activeTab === 'Rank Guardian' && (
                        <div className="rank-guardian-container">
                            <RankGuardian item={item} editedSeo={editedSeo} editedContent={editedContent} onSeoChange={handleSeoChange} onUrlChange={e => setEditedSeo(p => ({...p, slug: e.target.value}))} onRegenerate={handleRegenerateSeo} isRegenerating={isRegenerating} isUpdate={!!item.originalUrl} geoTargeting={geoTargeting} />
                        </div>
                    )}
                     {activeTab === 'Raw JSON' && <pre style={{padding: '2rem', color: '#64748B', overflow: 'auto'}}>{JSON.stringify(item.generatedContent, null, 2)}</pre>}
                </div>
                <div className="modal-footer">
                    <div style={{marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '1rem'}}>
                        {wpPublishMessage && <span className={wpPublishStatus === 'error' ? 'error' : 'success'}>{wpPublishMessage}</span>}
                        {publishedLink && <a href={publishedLink} target="_blank" rel="noopener noreferrer" className="btn btn-small" style={{backgroundColor: 'var(--accent-success)', color: 'white', textDecoration: 'none'}}>View Post &rarr;</a>}
                    </div>
                    <button className="btn btn-secondary" onClick={() => onSaveChanges(item.id, editedSeo, editedContent)}>Save Changes</button>
                    <div style={{display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '8px'}}>
                        <select value={publishAction} onChange={e => setPublishAction(e.target.value as any)} style={{background: 'transparent', border: 'none', color: 'white'}}><option value="publish">Publish</option><option value="draft">Draft</option></select>
                        <button className="btn" onClick={handlePublishToWordPress} disabled={wpPublishStatus === 'publishing'}>{wpPublishStatus === 'publishing' ? 'Publishing...' : 'Publish'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const AppFooter = memo(() => (
    <footer className="app-footer">
        <div className="footer-content">
            <div className="footer-brand">
                <img src="https://affiliatemarketingforsuccess.com/wp-content/uploads/2023/03/cropped-Affiliate-Marketing-for-Success-Logo-Edited.png?lm=6666FEE0" alt="Logo" className="footer-logo-img" />
                <p className="footer-desc">SOTA Content Orchestration Suite v11.0</p>
            </div>
            <div className="footer-links">
                <a href="#">Docs</a>
                <a href="#">API</a>
                <a href="#">Support</a>
            </div>
        </div>
        <div className="footer-bottom"><p>&copy; 2025 WP Content Optimizer Pro. Engineered by Alexios Papaioannou.</p></div>
    </footer>
));

// 🚀 SOTA BULK PUBLISHER MODAL (FIXED)
export const BulkPublishModal = ({ items, onClose, publishItem, wpConfig, wpPassword, onPublishSuccess }: any) => {
    const [isPublishing, setIsPublishing] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState({ current: 0, total: items.length });

    const startPublishing = async () => {
        setIsPublishing(true);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Starting bulk publish operation...`]);
        let successCount = 0;

        // Sequential processing to avoid 429 errors on WP API
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            setProgress({ current: i + 1, total: items.length });
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Publishing: ${item.title}...`]);
            
            try {
                // SOTA: Force publish status for bulk operations
                const status = 'publish'; 
                const result = await publishItem(item, wpPassword, status);
                
                if (result.success) {
                    setLogs(prev => [...prev, `✅ Success: ${item.title}`]);
                    if (onPublishSuccess) onPublishSuccess(result.link || item.title);
                    successCount++;
                } else {
                    setLogs(prev => [...prev, `❌ Failed: ${item.title} - ${result.message}`]);
                }
            } catch (e: any) {
                setLogs(prev => [...prev, `❌ Error: ${item.title} - ${e.message}`]);
            }
            // 500ms delay to be gentle on the server
            await new Promise(r => setTimeout(r, 500));
        }
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Batch Complete. Successfully published ${successCount}/${items.length} items.`]);
        setIsPublishing(false);
    };

    return (
        <div className="modal-overlay" onClick={isPublishing ? undefined : onClose}>
            <div className="modal-content" style={{maxWidth: '700px', height: 'auto', maxHeight: '85vh', padding: '2rem', display: 'flex', flexDirection: 'column', background: '#0F172A', border: '1px solid #334155', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                    <h2 className="gradient-headline" style={{fontSize: '1.5rem', margin: 0}}>Bulk Publisher</h2>
                    {!isPublishing && <button onClick={onClose} style={{background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.5rem'}}>&times;</button>}
                </div>
                
                <div style={{marginBottom: '1.5rem', flex: 1, minHeight: '300px', overflowY: 'auto', background: '#020617', padding: '1.5rem', borderRadius: '12px', fontFamily: 'monospace', fontSize: '0.85rem', color: '#E2E8F0', border: '1px solid #1E293B', boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.3)'}}>
                    {logs.length === 0 ? (
                        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748B'}}>
                            <p style={{marginBottom: '1rem'}}>Ready to publish {items.length} items to:</p>
                            <div style={{background: '#1E293B', padding: '0.5rem 1rem', borderRadius: '6px', color: '#94A3B8', fontSize: '0.9rem'}}>{wpConfig.url}</div>
                        </div>
                    ) : (
                        logs.map((log, i) => <div key={i} style={{marginBottom: '6px', lineHeight: '1.4', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px'}}>{log}</div>)
                    )}
                </div>

                {isPublishing && (
                    <div style={{marginBottom: '1.5rem'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8rem', color: '#94A3B8'}}>
                            <span>Progress</span>
                            <span>{Math.round((progress.current / Math.max(1, progress.total)) * 100)}%</span>
                        </div>
                        <div style={{width: '100%', height: '8px', background: '#1E293B', borderRadius: '4px', overflow: 'hidden'}}>
                            <div style={{width: `${(progress.current / Math.max(1, progress.total)) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)', transition: 'width 0.3s ease-out'}} />
                        </div>
                    </div>
                )}

                <div style={{display: 'flex', justifyContent: 'flex-end', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid #1E293B'}}>
                    <button className="btn btn-secondary" onClick={onClose} disabled={isPublishing}>
                        {isPublishing ? 'Publishing...' : 'Close'}
                    </button>
                    {!isPublishing && (
                        <button className="btn" onClick={startPublishing} disabled={logs.length > 0 && logs[logs.length-1].includes('Complete')}>
                            {logs.length > 0 && logs[logs.length-1].includes('Complete') ? 'Done' : 'Start Publishing'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    ); 
};

export const AnalysisModal = ({ page, onClose, onPlanRewrite }: any) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{maxWidth: '800px', height: 'auto', maxHeight: '90vh', padding: '2rem'}}>
                <h2 className="gradient-headline" style={{fontSize: '1.5rem'}}>Analysis</h2>
                <p>{page.analysis?.critique}</p>
                <button className="btn" onClick={() => { onPlanRewrite(page); onClose(); }}>Plan Rewrite</button>
            </div>
        </div>
    );
};

export const WordPressEndpointInstructions = ({ onClose }: { onClose: () => void }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" style={{maxWidth: '500px', height: 'auto', padding: '2rem'}}>
            <h3>Instructions</h3><p>Use Application Passwords.</p><button className="btn" onClick={onClose}>Close</button>
        </div>
    </div>
);
