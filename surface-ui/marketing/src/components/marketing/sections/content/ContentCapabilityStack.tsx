import { Sparkles, PenTool, Layers, Share2, Globe, Database, HelpCircle, Target, Search } from "lucide-react";
import { ContentCapabilityRow } from "./ContentCapabilityRow";
import cap1 from "@v3/marketing/assets/content/Content_Child1_Your_voice.png";
import cap2 from "@v3/marketing/assets/content/Content_Child2_Publish_once.png";
import cap3 from "@v3/marketing/assets/content/Content_Child3_Answer.png";

export const ContentCapabilityStack = () => {
  return (
    <>
      <ContentCapabilityRow
        headline="Your voice, powered by your AI writing studio"
        description="Create content in collaboration with an AI studio designed for professionals. Research topics, draft articles, and refine your message while staying in total control of your unique brand voice."
        bullets={[
          { icon: Sparkles, text: "AI-assisted topic research and drafting" },
          { icon: PenTool, text: "Professional formatting and tone refinement" },
          { icon: Layers, text: "Scale your output without losing consistency" },
        ]}
        image={cap1}
        alt="AI writing studio interface generating an article draft with options to rewrite, simplify, expand, and explain content, showing draft created in 36 seconds"
        background="light"
      />
      <ContentCapabilityRow
        headline="Publish once. Share everywhere."
        description="Articles automatically reach your followers and sync across social channels. Boost your reach to Google's display network to ensure your visibility follows customers wherever they search."
        bullets={[
          { icon: Share2, text: "Automated social channel syndication" },
          { icon: Globe, text: "Google Display Network integration" },
          { icon: Database, text: "Structured content for easier AI referencing" },
        ]}
        image={cap2}
        alt="Published article syndicated to Facebook, Instagram, X, and LinkedIn followers with a Google Display Network boost option to extend reach across search and social channels"
        reverse
      />
      <ContentCapabilityRow
        headline="Answer the real questions customers are asking"
        description="Modern search is driven by questions. We make it easy to publish answers tied to your expertise so you appear at the exact moment a customer is making a decision."
        bullets={[
          { icon: HelpCircle, text: "Question-based content templates" },
          { icon: Target, text: "Expertise-linked search signals" },
          { icon: Search, text: "Decision-moment visibility" },
        ]}
        image={cap3}
        alt="Ask and Answer content workflow showing a real customer question answered by a local expert, with AI-assisted drafting building question-based content for search and AI discovery"
        background="light"
      />
    </>
  );
};
