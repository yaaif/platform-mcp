/** Maintained YAAIF adaptation, not a vendored NVIDIA manual. No runtime fetches. */
export declare const skillSecurityGuideTopics: readonly ["overview", "triage", "repair", "troubleshooting", "sources"];
export type SkillSecurityGuideTopic = (typeof skillSecurityGuideTopics)[number];
export declare const skillSecurityGuideSources: {
    title: string;
    url: string;
    scope: string;
}[];
export declare function skillSecurityGuide(topic?: SkillSecurityGuideTopic): {
    title: string;
    revision: string;
    upstream_reference_revision: string;
    topics: ("overview" | "triage" | "repair" | "troubleshooting" | "sources")[];
    sections: {
        [topic]: string;
    } | {
        overview: string;
        triage: string;
        repair: string;
        troubleshooting: string;
        sources: string;
    };
    sources: {
        title: string;
        url: string;
        scope: string;
    }[];
    offline: boolean;
    read_only: boolean;
    next_step: string;
};
