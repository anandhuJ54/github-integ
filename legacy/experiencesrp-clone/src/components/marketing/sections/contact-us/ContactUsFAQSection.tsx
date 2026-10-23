import { ChevronDown, Search } from "lucide-react";
import { useState, useMemo } from "react";

const faqs: { question: string; answer: string }[] = [
  {
    question: "What is the Search Rank Platform?",
    answer:
      "The Search Rank Platform (SRP) is a search visibility platform that tracks your Search Rank Score® and the signals behind it. It brings together your profiles, reviews, listings, and website signals and shows exactly what to improve to rank higher.",
  },
  {
    question: "What is a Search Rank Score®?",
    answer:
      "Search Rank Score® is a proprietary score that measures how visible and trustworthy your business appears to search engines and AI systems. It analyzes signals like reviews, profile strength, listings consistency, connections, and website health to show how likely your business is to be discovered when customers search.",
  },
  {
    question: "Why is search visibility important for businesses today?",
    answer:
      "Most customers begin their buying journey with a search query. If your business does not appear prominently in search results or AI recommendations, customers may choose competitors instead. Improving search visibility helps ensure your business is discovered when potential customers are actively looking for services.",
  },
  {
    question: "How do AI search engines decide which businesses to recommend?",
    answer:
      "AI search systems analyze a range of signals to determine which businesses are trustworthy and relevant. These signals include online reviews, profile authority, content in areas of expertise, consistent business information across directories, website quality, and connections across trusted platforms. Businesses with stronger signals are more likely to be cited or recommended by AI.",
  },
  {
    question: "How does the Search Rank Platform help improve search rankings?",
    answer:
      "The Search Rank Platform improves rankings by strengthening the signals search engines rely on. It helps businesses build authoritative profiles, collect and respond to reviews, maintain consistent listings, connect key platforms, and optimize website performance, all of which contribute to better search visibility.",
  },
  {
    question: "How do online reviews influence search rankings?",
    answer:
      "Online reviews help search engines understand which businesses are trusted by customers. A steady stream of authentic reviews, along with thoughtful responses, strengthens credibility signals that can improve visibility in search results and AI-generated recommendations.",
  },
  {
    question: "Why are public profile pages important for search visibility?",
    answer:
      "Public profile pages act as a structured source of truth about your business. Search engines use these pages to verify identity, services, reviews, and expertise. A strong profile helps reinforce trust signals that contribute to higher rankings.",
  },
  {
    question: "What role do business listings play in search rankings?",
    answer:
      "Consistent business information across directories helps search engines confirm that your business is legitimate and active. Listings with accurate names, addresses, phone numbers, and services strengthen credibility and improve local search visibility.",
  },
  {
    question: "What are connection signals in search ranking?",
    answer:
      "Connection signals refer to the network of platforms where your business is verified and active, such as Google, Facebook, Zillow, and other review or social platforms. When search engines see consistent activity across trusted platforms, it strengthens authority signals and improves discoverability.",
  },
  {
    question: "How does website performance impact search visibility?",
    answer:
      "Search engines evaluate website quality as part of ranking decisions. Factors like page speed, mobile usability, structured data, and content quality influence whether a website is considered trustworthy and relevant. Improving these elements helps increase your chances of ranking higher.",
  },
  {
    question: "How does the Search Rank Platform help businesses compete online?",
    answer:
      "The Search Rank Platform provides a clear view of the signals affecting your visibility. Instead of guessing why rankings fluctuate, businesses can track their Search Rank Score®, compare performance with competitors, and take targeted actions to improve discoverability across search and AI.",
  },
  {
    question: "Is the Search Rank Platform free to use?",
    answer:
      "Yes. Businesses and individual professionals can sign up for free to view their Search Rank Score® and understand the factors affecting their visibility. From there, they can explore tools that help strengthen search signals and improve ranking performance.",
  },
  {
    question: "Do I have to pay to improve my Search Rank Score®?",
    answer:
      "No. The Search Rank Platform is designed to help you improve your visibility—not pay for rankings. The free experience includes a 550-point Search Rank Score® foundation. PRO unlocks additional tools like Listings, Web Analytics, and Google integrations that support high-impact visibility signals and require additional infrastructure to maintain.",
  },
  {
    question: "Does upgrading my plan automatically improve my Search Rank Score?",
    answer:
      "Search Rank Score isn't about buying rankings. It's about unlocking the potential to earn them. The additional cost of the 850 plan covers access to tools like listings, web analytics, and Google integrations. You're paying for those features, not for points. Your score only improves if you put in the work. Simply upgrading your plan won't move your number — you have to use what it unlocks.",
  },
  {
    question: "What is an Experience Management Platform?",
    answer:
      "An Experience Management Platform helps organizations collect feedback, manage reputation, automate outreach, and track performance across customer and employee experiences. Experience.com's Experience Management Platform (XMP) centralizes these capabilities so enterprises can manage experiences consistently across teams and locations.",
  },
  {
    question: "What does Experience.com's Experience Management Platform do?",
    answer:
      "Experience.com's Experience Management Platform enables enterprises to capture feedback, automate surveys and review requests, manage reputation, run targeted campaigns, and monitor experience performance across locations. The platform connects these signals into one system so organizations can improve customer and employee experience while strengthening their online visibility.",
  },
  {
    question: "How does the Experience Management Platform help multi-location businesses?",
    answer:
      "For multi-location organizations, the platform centralizes feedback, reviews, campaigns, and governance across every team and location. This allows enterprises to maintain brand consistency, monitor reputation, and manage customer experience at scale while giving local teams the tools they need to improve performance.",
  },
  {
    question: "How does Experience.com help enterprises manage reputation at scale?",
    answer:
      "The platform helps enterprises collect reviews, monitor feedback, and respond quickly via escalation workflows as well as AI-assisted replies. By managing reputation signals across locations and platforms, organizations can strengthen trust with customers while maintaining a consistent brand presence.",
  },
  {
    question: "How does Experience.com improve local search visibility?",
    answer:
      "Experience.com improves local search visibility by turning customer feedback and reviews into structured signals that search engines and AI platforms use to rank and recommend local businesses. The platform automates review collection, manages business listings across 100+ platforms, and connects experience data directly to local search ranking performance.",
  },
  {
    question: "How does the Experience Management Platform support AI search visibility?",
    answer:
      "The platform transforms location expertise, customer feedback, and reputation signals into structured, machine-readable data. This helps search engines and AI-driven discovery systems better understand each location, increasing the likelihood that your business is recognized and recommended in search and AI results.",
  },
  {
    question: "Can the Experience Management Platform automate surveys and review requests?",
    answer:
      "Yes. The platform can automatically trigger surveys and review requests through email and SMS at key moments in the customer journey. This helps businesses capture timely feedback, improve response rates, and generate consistent reputation signals across locations.",
  },
  {
    question: "Can the platform integrate with CRM and POS systems?",
    answer:
      "Yes. Experience.com's Experience Management Platform integrates with existing systems such as CRM and POS tools. These integrations allow businesses to trigger feedback requests based on real customer interactions and connect operational data with customer experience insights.",
  },
  {
    question: "Who is the Experience Management Platform designed for?",
    answer:
      "The Experience Management Platform is designed for enterprises and multi-location organizations that need to capture feedback, manage reputation, automate outreach, and monitor experience performance across teams, departments, and locations from one centralized platform.",
  },
  {
    question: "What is search ranking?",
    answer:
      "Search ranking refers to where your business appears in search results when customers are looking for services like yours. Higher rankings increase the likelihood that your business is seen, trusted, and chosen across both traditional search engines and AI-powered discovery.",
  },
  {
    question: "How can businesses measure their search ranking?",
    answer:
      "Businesses can measure search ranking by tracking their visibility across key signals such as profiles, listings, reviews, website performance, and content. Experience.com's Search Rank Score® brings these signals together into one system so businesses can understand where they stand and how to improve.",
  },
  {
    question: "What is Search Rank Score®?",
    answer:
      "Search Rank Score® is a proprietary scoring system that measures how visible and competitive your business is in your local market. It analyzes hundreds of signals across profiles, listings, reviews, website performance, content, and AI visibility to show how likely your business is to be discovered.",
  },
  {
    question: "Why does search ranking matter for businesses?",
    answer:
      "Search ranking matters because customers often choose from the businesses they see first. When your business ranks higher, it increases visibility, builds trust, and improves the chances of being selected by customers who are actively searching.",
  },
  {
    question: "How does Experience.com help improve search ranking?",
    answer:
      "Experience.com helps businesses improve search ranking by turning visibility into a measurable system. It shows where you rank, compares your performance to competitors, and provides prioritized actions that strengthen the signals that influence discovery.",
  },
  {
    question: "How does Search Ranking compare performance against competitors?",
    answer:
      "Search Ranking provides local market comparisons and leaderboard views that show how your business performs relative to competitors. This helps identify gaps, track progress over time, and focus on improvements that increase visibility in your market.",
  },
  {
    question: "What signals influence search ranking?",
    answer:
      "Search ranking is influenced by multiple signals, including profile completeness, listing accuracy, review volume and responses, customer sentiment, website performance, content quality, and AI visibility. Strong, consistent signals across these areas improve discoverability.",
  },
  {
    question: "What is the Search Rank Game?",
    answer:
      "The Search Rank Game is a guided system that helps businesses improve visibility through prioritized actions. It uses action cards tied to real ranking signals, making it easier to take the right steps and track progress as your Search Rank Score improves.",
  },
  {
    question: "Can Search Ranking improve visibility in AI-powered search?",
    answer:
      "Yes. Search Ranking helps strengthen the signals that AI-powered search systems use to evaluate and recommend businesses. By improving consistency, content, reputation, and structure, businesses increase their likelihood of being surfaced in AI-generated results.",
  },
  {
    question: "How does Search Ranking connect to reviews, listings, profiles, and content?",
    answer:
      "Search Ranking connects to all major visibility signals, including reviews, listings, profiles, and content. Improvements in any of these areas contribute to stronger overall visibility, helping businesses perform better across search engines and AI-driven discovery.",
  },
  {
    question: "Who is Search Ranking built for?",
    answer:
      "Search Ranking is built for businesses, professionals, and multi-location organizations that want to understand their visibility, benchmark performance, and improve their position across search and AI-powered discovery using one connected system.",
  },
  {
    question: "What is review management software?",
    answer:
      "Review management software helps businesses collect, monitor, respond to, and distribute customer reviews from one place. Experience.com's Reviews product helps teams turn customer feedback into trust signals that strengthen reputation, improve search visibility, and influence AI-powered recommendations.",
  },
  {
    question: "How do customer reviews help businesses get chosen?",
    answer:
      "Customer reviews help businesses build trust at the moment customers are comparing options. Fresh, authentic reviews give buyers confidence, reinforce credibility across channels, and increase the likelihood that a business is selected over competitors.",
  },
  {
    question: "How do reviews influence search visibility?",
    answer:
      "Reviews create fresh, relevant content and trust signals that search engines use to evaluate business credibility. A consistent flow of authentic reviews can improve local search performance, strengthen authority, and help businesses appear more prominently when customers are searching.",
  },
  {
    question: "Can reviews help businesses appear in AI-powered recommendations?",
    answer:
      "Yes. Reviews give AI systems more trustworthy signals about customer experience, reputation, and business quality. When reviews are recent, authentic, specific, and consistently managed, they help AI-driven search models better understand which businesses are credible enough to recommend.",
  },
  {
    question: "How does Experience.com help businesses collect more reviews?",
    answer:
      "Experience.com helps businesses automatically request reviews through SMS and email at the right moments in the customer journey. This makes it easier to capture feedback while the experience is still fresh, improving response rates without creating friction for customers.",
  },
  {
    question: "How does Experience.com help teams manage and respond to reviews?",
    answer:
      "Experience.com gives teams a centralized dashboard to monitor reviews across platforms and respond from one place. AI-assisted reply suggestions help businesses respond faster while maintaining brand consistency, accuracy, and compliance.",
  },
  {
    question: "How does Experience.com help businesses use reviews across the buyer journey?",
    answer:
      "Experience.com helps businesses activate reviews beyond a single profile by syndicating verified feedback across profiles and social channels. This allows strong customer sentiment to reinforce credibility wherever buyers are researching and making decisions.",
  },
  {
    question: "Is Experience.com's Reviews product built for multi-location and enterprise teams?",
    answer:
      "Yes. Experience.com's Reviews product is built for organizations that need control and consistency at scale. It supports governance workflows, hierarchy-based permissions, moderation tools, and multi-location review management so brands can protect reputation while growing efficiently.",
  },
  {
    question: "What is campaign automation software?",
    answer:
      "Campaign automation software helps businesses send targeted outreach based on customer actions and timing. Experience.com's Campaigns product helps businesses automate personalized email and SMS campaigns that drive reviews, referrals, retention, and engagement without adding manual work.",
  },
  {
    question: "How do automated campaigns help businesses grow?",
    answer:
      "Automated campaigns help businesses stay connected to customers at the right moments with relevant outreach. By sending the right message at the right time, businesses can increase engagement, generate more reviews, strengthen loyalty, and improve customer retention.",
  },
  {
    question: "Why does timing matter in customer outreach?",
    answer:
      "Timing matters because customers are more likely to respond when outreach happens close to a real experience or transaction. Triggering campaigns at the moment of truth increases relevance, improves completion rates, and helps businesses capture more meaningful engagement.",
  },
  {
    question: "How does Experience.com help businesses automate customer outreach?",
    answer:
      "Experience.com helps businesses automate outreach through SMS and email campaigns triggered by customer behaviors, transactions, or visit history. This allows businesses to deliver timely, personalized communication that feels relevant and supports stronger conversion outcomes.",
  },
  {
    question: "Can Experience.com trigger campaigns based on customer behavior?",
    answer:
      "Yes. Experience.com allows businesses to trigger campaigns based on transaction events, visit history, and other customer actions. This helps teams automate outreach with greater precision so messaging reaches customers when they are most likely to engage.",
  },
  {
    question: "How do SMS and email campaigns improve review generation?",
    answer:
      "SMS and email campaigns make it easier to request feedback and reviews while customer experiences are still fresh. Mobile-optimized delivery and timely outreach can increase response rates, helping businesses generate more authentic reviews and stronger reputation signals.",
  },
  {
    question: "Can businesses personalize campaigns at scale?",
    answer:
      "Yes. Experience.com helps businesses personalize campaigns with dynamic templates, brand-approved designs, location-specific messaging, and audience segmentation. This allows organizations to maintain consistency while tailoring outreach across teams, regions, and customer groups.",
  },
  {
    question: "How do automated campaigns support customer loyalty and referrals?",
    answer:
      "Automated campaigns help businesses stay engaged with customers after key interactions, making it easier to request referrals, distribute loyalty rewards, and identify brand advocates. This helps turn positive experiences into repeat business and long-term growth.",
  },
  {
    question: "How does Experience.com help measure campaign performance?",
    answer:
      "Experience.com helps businesses track campaign performance through real-time delivery, conversion insights, and multi-location performance reporting. These insights help teams understand what is driving engagement, reputation growth, and customer response across campaigns.",
  },
  {
    question: "How do campaigns connect to search visibility and reputation growth?",
    answer:
      "Campaigns help generate reviews, customer feedback, and engagement signals that contribute to reputation and visibility. When campaign outreach is connected to review management and listings, it can help strengthen the signals that support search discovery and customer trust.",
  },
  {
    question: "What is listings management software?",
    answer:
      "Listings management software helps businesses manage and update their business information across search engines, maps, and online directories from one place. Experience.com's Listings product helps businesses keep location details accurate, consistent, and visible so customers can find them more easily.",
  },
  {
    question: "Why are business listings important for search visibility?",
    answer:
      "Business listings are one of the strongest trust signals search engines use to evaluate relevance and legitimacy. When your business information is complete and consistent across the web, it strengthens visibility in local search, maps, and other discovery experiences where customers are looking.",
  },
  {
    question: "How do accurate business listings help customers find a business?",
    answer:
      "Accurate business listings ensure customers see the right name, address, phone number, hours, and services when they search. This reduces confusion, improves trust, and helps customers choose your business at the exact moment they are ready to call, visit, or take action.",
  },
  {
    question: "How do listings affect local SEO?",
    answer:
      "Listings support local SEO by giving search engines consistent business data they can trust. When information matches across Google, maps, and directories, it helps reinforce relevance, improve local search visibility, and increase the likelihood that a business appears in location-based search results.",
  },
  {
    question: "Can listings help businesses appear in AI-powered search results?",
    answer:
      "Yes. AI-powered search systems rely on accurate and trustworthy business information when deciding which businesses to surface. Consistent listings across platforms help reinforce legitimacy and improve the chances that your business is recognized in AI-driven discovery.",
  },
  {
    question: "How does Experience.com help businesses manage listings?",
    answer:
      "Experience.com gives businesses a centralized dashboard to manage essential details such as name, address, phone number, hours, and services across locations. Changes can be published across search engines, maps, and directories from one place, helping businesses reduce errors and maintain consistency.",
  },
  {
    question: "Can Experience.com manage Google Business Profiles and other directories?",
    answer:
      "Yes. Experience.com helps businesses manage their presence across Google, maps, and more than 100 digital platforms. This allows teams to maintain accurate information, manage visibility, and keep important location details aligned across the web.",
  },
  {
    question: "How does Experience.com help monitor listing health?",
    answer:
      "Experience.com helps businesses track listing health by identifying inconsistencies, missing information, and unauthorized changes that could affect visibility or customer trust. This makes it easier to protect listing accuracy and address issues before they impact performance.",
  },
  {
    question: "Is Experience.com's Listings product built for multi-location businesses?",
    answer:
      "Yes. Experience.com's Listings product is built for businesses that need to manage brand consistency and location accuracy at scale. It supports centralized publishing, smart location management, and controlled access so enterprises can maintain trust across many teams and locations.",
  },
  {
    question: "Why are listings considered the foundation of discovery?",
    answer:
      "Listings are often the first place customers encounter a business in search, maps, and directory results. When that information is accurate and trustworthy, it creates the foundation for visibility, engagement, and customer action at the start of the buying journey.",
  },
  {
    question: "What is social media management software?",
    answer:
      "Social media management software helps businesses create, schedule, publish, and manage content across multiple social platforms from one place. Experience.com's Social product helps businesses stay visible, maintain brand consistency, and turn customer feedback into social content without adding manual effort.",
  },
  {
    question: "How does social media management help businesses stay visible?",
    answer:
      "Social media management helps businesses stay active and consistent across the platforms where customers engage. When businesses publish regularly and maintain a steady presence, they stay top of mind and reinforce trust with both current and potential customers.",
  },
  {
    question: "How does Experience.com help businesses manage social media from one place?",
    answer:
      "Experience.com gives businesses a centralized dashboard to create posts, preview content, schedule updates, and publish across multiple social platforms. This makes it easier to manage a social presence efficiently while keeping messaging and branding consistent.",
  },
  {
    question: "Can businesses schedule social media posts in advance?",
    answer:
      "Yes. Experience.com helps businesses plan content ahead of time by scheduling posts days or weeks in advance. Teams can prepare captions, upload media, preview how posts will appear on each platform, and publish at the right times without daily manual work.",
  },
  {
    question: "Can Experience.com publish to multiple social platforms at once?",
    answer:
      "Yes. Experience.com helps businesses publish content across major social platforms from one dashboard. This allows teams to write once, share everywhere, and maintain a more consistent presence without repeating the same work on each channel.",
  },
  {
    question: "How does Experience.com turn reviews into social content?",
    answer:
      "Experience.com helps businesses automatically turn strong customer reviews into branded social posts. By sharing positive feedback across social channels, businesses can extend the reach of their reputation and build credibility where customers are already engaging.",
  },
  {
    question: "How do customer reviews help social media marketing?",
    answer:
      "Customer reviews add authentic social proof to social media content. When businesses share real customer feedback, it helps build trust, strengthen credibility, and make social posts more persuasive to potential customers who are evaluating their options.",
  },
  {
    question: "How does Experience.com help maintain brand consistency on social media?",
    answer:
      "Experience.com helps businesses maintain brand consistency with centralized publishing, post previews, customizable templates, and controlled scheduling workflows. This helps teams ensure that content looks accurate, on-brand, and aligned across locations and profiles.",
  },
  {
    question: "Is Experience.com's Social product built for multi-location businesses?",
    answer:
      "Yes. Experience.com's Social product is designed for businesses that need to manage multiple profiles, locations, and teams from one secure dashboard. It helps organizations scale their social presence while maintaining oversight, consistency, and control.",
  },
  {
    question: "How does social media connect to reputation and visibility?",
    answer:
      "Social media helps amplify the reputation signals and business updates that support visibility across the web. When businesses share reviews, updates, and trusted content consistently, they strengthen their digital presence and keep their brand visible wherever customers are paying attention.",
  },
  {
    question: "What is website optimization software for search visibility?",
    answer:
      "Website optimization software helps businesses improve the performance, structure, and trust signals of their web presence so customers can find them more easily. Experience.com's Website product helps businesses audit their sites, strengthen search and AI signals, and launch high-performance profiles and websites that support visibility and conversion.",
  },
  {
    question: "How does website performance affect search visibility?",
    answer:
      "Website performance affects how search engines evaluate trust, usability, and relevance. Factors like page load speed, site security, structured information, and overall completeness influence whether a website is positioned to rank well and create a strong experience for customers.",
  },
  {
    question: "What is a Web Analytics Score?",
    answer:
      "A Web Analytics Score measures the health of a website across important search and visibility factors. Experience.com's Web Analytics Score evaluates signals such as business information, profile data, HTML structure, site security, reviews, and other key elements so businesses can prioritize the fixes that matter most.",
  },
  {
    question: "How does Experience.com help businesses audit their website?",
    answer:
      "Experience.com helps businesses scan their website against the signals search engines reward, identify gaps, and focus on high-impact improvements. The platform provides prioritized recommendations, tracks website completion, and allows businesses to refresh their score on demand to measure progress over time.",
  },
  {
    question: "What is a web profile and why does it matter?",
    answer:
      "A web profile is a customer-facing online destination that showcases important business information, reviews, ratings, and recognition in one place. A highly indexed web profile helps businesses strengthen trust signals, improve discoverability, and give customers a clear place to evaluate and choose them.",
  },
  {
    question: "How does Experience.com help businesses create high-performance web profiles?",
    answer:
      "Experience.com helps businesses launch highly indexed web profiles designed to build trust and drive action. These profiles bring together reviews, ratings, recognition, and complete business details so customers can easily find, assess, and engage with a business online.",
  },
  {
    question: "Can Experience.com help businesses build search-optimized websites at scale?",
    answer:
      "Yes. Experience.com helps organizations create fully managed, search-optimized websites designed for multiple teams, locations, or brands. These websites are structured to support visibility, compliance, performance, and long-term growth as the business expands.",
  },
  {
    question: "How do websites support AI-powered search visibility?",
    answer:
      "Websites support AI-powered search visibility by providing structured, trustworthy, and complete information that AI systems can interpret. Strong site performance, clear business details, and connected trust signals help AI-powered search systems better understand a business and increase the likelihood that it is surfaced in results.",
  },
  {
    question: "How does Experience.com help businesses improve visibility in local markets?",
    answer:
      "Experience.com helps businesses strengthen local visibility with indexed profiles, search-focused website improvements, and options to promote visibility in targeted ZIP codes. This helps businesses appear more prominently in the markets where customers are actively searching and making decisions.",
  },
  {
    question: "How does website performance connect to reviews, listings, and profiles?",
    answer:
      "Website performance works best when it is aligned with the entirety of a business's digital presence. When websites, profiles, reviews, and listings reinforce the same trust and accuracy signals, they strengthen search visibility together and help customers move from discovery to action with more confidence.",
  },
  {
    question: "What is AI visibility in search?",
    answer:
      "AI visibility refers to how likely your business is to be surfaced, referenced, or chosen in AI-generated answers when customers search. Instead of focusing only on traditional rankings, AI visibility measures how well your business is positioned to be recognized as a trusted source by AI-powered search systems.",
  },
  {
    question: "How does AI-powered search choose which businesses to reference?",
    answer:
      "AI-powered search systems generate answers by selecting sources they view as relevant, credible, and consistent. Businesses are more likely to be chosen when they demonstrate expertise, publish helpful content, maintain accurate business information, and reinforce trust signals across their online presence.",
  },
  {
    question: "What is an AI Authority Score?",
    answer:
      "An AI Authority Score reflects how strongly your business is positioned to be used as a source in AI-generated answers. It brings together signals tied to expertise, relevance, and consistency so you can understand what supports stronger AI visibility over time.",
  },
  {
    question: "Why does AI visibility matter for businesses?",
    answer:
      "As more customers use AI-powered search to discover businesses, visibility is no longer just about appearing in a list of links. Businesses that are recognized and referenced in AI-generated answers have a better chance of being considered, trusted, and chosen during the decision-making process.",
  },
  {
    question: "How can businesses improve AI visibility?",
    answer:
      "Businesses can improve AI visibility by publishing useful content, answering common customer questions, maintaining accurate profiles, and reinforcing expertise across the web. Strong business information, consistent signals, and ongoing publishing all help AI systems better understand and trust your business.",
  },
  {
    question: "How does content help increase AI visibility?",
    answer:
      "Content helps businesses demonstrate expertise in the topics customers are searching for. When a business consistently publishes clear, relevant, and helpful content, it strengthens the signals that AI-powered search systems use to determine whether that business should be referenced in generated answers.",
  },
  {
    question: "How does Experience.com help businesses improve AI visibility?",
    answer:
      "Experience.com helps businesses measure and strengthen AI visibility by showing how they appear in AI-powered search and identifying what improves their likelihood of being surfaced. It connects visibility insights with the content, authority, and search foundation needed to help businesses become stronger AI search sources.",
  },
  {
    question: "How does AI Visibility connect to search performance?",
    answer:
      "AI visibility builds on the same signals that support strong search performance, including accurate business information, consistent profiles, and active publishing. When these signals work together, they strengthen trust, reinforce relevance, and improve the likelihood that a business is surfaced in both search and AI-generated answers.",
  },
  {
    question: "What is performance insights software for customer experience and visibility?",
    answer:
      "Performance insights software helps businesses track visibility, engagement, and search performance in one place. Experience.com's Insights product helps teams understand how customers find them, how they engage, and which signals are driving performance across profiles, search, reviews, and campaigns.",
  },
  {
    question: "How does Insights help businesses understand visibility performance?",
    answer:
      "Insights helps businesses see how visibility translates into engagement by tracking profile views, impressions, clicks, and customer actions over time. This makes it easier to understand what is working, identify changes early, and focus on the areas that have the greatest impact on growth.",
  },
  {
    question: "Can businesses see where customers are finding them?",
    answer:
      "Yes. Experience.com helps businesses understand where customers are discovering them by showing visitor activity, engagement patterns, and geographic trends. Teams can see which markets are strongest, where visibility is growing, and where new opportunities may exist.",
  },
  {
    question: "How does Experience.com help track profile and website engagement?",
    answer:
      "Experience.com helps businesses monitor impressions, clicks, views, and engagement across their Experience.com profile and related digital presence. This gives teams a clearer view of how search visibility turns into customer interest and action.",
  },
  {
    question: "Can Insights show performance trends over time?",
    answer:
      "Yes. Experience.com helps businesses visualize performance across daily, weekly, monthly, and annually timeframes. This helps teams track momentum, understand long-term progress, and identify patterns across organic visibility, branded search, and engagement performance.",
  },
  {
    question: "How does Experience.com measure review and outreach performance?",
    answer:
      "Experience.com helps businesses track where reviews originate and how outreach performs across channels. Teams can measure delivery, opens, clicks, and conversions to reviews, making it easier to understand what drives response, trust, and reputation growth.",
  },
  {
    question: "How does Insights help businesses analyze performance at scale?",
    answer:
      "Insights helps organizations generate reports across teams, locations, campaigns, and time periods. This makes it easier to compare performance, identify trends, and share clear reporting that supports better decisions across distributed teams and multi-location operations.",
  },
  {
    question: "Can teams monitor key metrics in real time?",
    answer:
      "Yes. Experience.com helps teams centralize important performance metrics into one view so they can monitor visibility, reputation, and experience outcomes in real time. This helps teams stay aligned and respond faster to changes that affect growth.",
  },
  {
    question: "How does Insights support accountability and performance improvement?",
    answer:
      "Insights helps businesses compare results across teams and locations, highlight top performers, and create visibility into progress over time. This supports accountability, motivates improvement, and helps organizations build consistency across campaigns and customer experience efforts.",
  },
  {
    question: "Can Experience.com track Google Search and Google Maps performance?",
    answer:
      "Yes. Experience.com helps businesses track Google Search views, Google Maps views, and customer actions from one dashboard. This helps teams understand how customers discover their brand across Google and use those insights to guide smarter decisions.",
  },
  {
    question: "Why are insights important for improving search visibility and rank?",
    answer:
      "Insights help businesses understand which actions and signals are contributing to visibility, engagement, and trust. When teams can clearly see what drives performance, they can prioritize improvements more effectively and make better decisions that support stronger search visibility over time.",
  },
  {
    question: "What is content marketing software for professional services?",
    answer:
      "Content marketing software helps businesses research, create, publish, and manage content that builds visibility and trust. Experience.com's Content product helps professionals and businesses create content that supports discovery across search and AI-powered results without adding extra tools or workflow complexity.",
  },
  {
    question: "How does content help customers find a business online?",
    answer:
      "Content helps businesses appear when customers search for topics, questions, and services related to their expertise. When content is clear, relevant, and consistently published, it strengthens visibility in search results and increases the chances that customers discover the business during key decision-making moments.",
  },
  {
    question: "How does content support AI-powered discovery?",
    answer:
      "AI-powered search systems look for useful, well-structured, and trustworthy content when generating answers. Publishing clear content tied to real expertise helps AI systems better understand what a business knows, making it more likely that the business is surfaced, referenced, or chosen in AI-powered discovery.",
  },
  {
    question: "How does Experience.com help businesses create content?",
    answer:
      "Experience.com gives businesses a dedicated workspace to research topics, draft articles, refine messaging, and manage publishing in one place. Powered by VOCE, the platform helps businesses create content efficiently while keeping control of voice, expertise, and brand consistency.",
  },
  {
    question: "What is VOCE?",
    answer:
      "Experience.com AI writing and publishing workspace partner. It is where businesses create and manage content, while Experience.com connects that content to visibility, reputation, and discovery across the web.",
  },
  {
    question: "Can businesses use AI to create content without losing their voice?",
    answer:
      "Yes. Experience.com's AI writing studio is designed to support content creation while keeping businesses in control of their voice and expertise. It helps research, draft, and refine content so teams can create more consistently without losing authenticity.",
  },
  {
    question: "How does publishing content improve search visibility?",
    answer:
      "Publishing content improves search visibility by giving search engines more relevant, topic-specific information to index and understand. Consistent publishing around real customer questions helps reinforce expertise, increase relevance, and improve the likelihood that a business appears in search results.",
  },
  {
    question: "How does Experience.com help businesses publish and distribute content?",
    answer:
      "Experience.com helps businesses publish content and extend its reach across channels. Articles can be shared with followers, distributed across social channels, and supported through broader publishing workflows so businesses can strengthen visibility wherever customers are searching.",
  },
  {
    question: "Why is answering customer questions important for visibility?",
    answer:
      "Customers often search in the form of questions. When a business publishes clear answers tied to its real expertise, it increases the likelihood of appearing in relevant searches and being considered during moments when customers are actively evaluating options.",
  },
  {
    question: "How does structured content support search and AI visibility?",
    answer:
      "Structured content makes it easier for search engines and AI-powered systems to understand topics, connect expertise, and evaluate trustworthiness. Clear formatting, consistent publishing, and connected business profiles help strengthen the signals that support visibility across both search and AI-powered discovery.",
  },
  {
    question: "How quickly will I hear back from someone?",
    answer:
      "Our team typically responds within 1 business day. For urgent needs, scheduling a call directly gets you on our calendar the fastest.",
  },
  {
    question: "What's the difference between scheduling a call and using the Knowledge Base?",
    answer:
      "Scheduling a call connects you directly with our sales team to discuss your goals, pricing, and the right plan for your business. The Knowledge Base is self-service — ideal if you just need a quick answer to a specific question.",
  },
  {
    question: "Do you offer a demo before I purchase?",
    answer:
      "Yes. Schedule a call and our team will walk you through a live demo tailored to your business — whether you're an individual professional or a multi-location enterprise.",
  },
  {
    question: "I'm an existing customer. Where do I go for support?",
    answer:
      "Existing customers should visit our Knowledge Base or contact Support directly through your account dashboard.",
  },
  {
    question: "Where can I find pricing information?",
    answer:
      "Pricing depends on your business size, goals, and which platform fits you best. Schedule a quick call and we'll give you a clear, tailored quote, or claim your free profile to begin exploring.",
  },
  {
    question: "Does Experience.com work for individual professionals and multi-location enterprises?",
    answer:
      "Yes. Our Search Rank Platform is built for individual professionals looking to grow their local search visibility and reputation, while our Experience Management Platform is designed for multi-location enterprises managing reputation and customer experience at scale.",
  },
  {
    question: "What industries does Experience.com support?",
    answer:
      "We work with professionals and enterprises across a variety of industries including: mortgage, real estate, insurance, financial services, legal, home services, health & wellness, along with multi-location and enterprise brands across all industries.",
  },
];

const DEFAULT_VISIBLE = 9;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.slice(0, DEFAULT_VISIBLE).map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export const ContactUsFAQSection = () => {
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faqs.slice(0, DEFAULT_VISIBLE);
    const tokens = q.split(/\s+/).filter(Boolean);
    const scored = faqs
      .map((f) => {
        const hay = (f.question + " " + f.answer).toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (f.question.toLowerCase().includes(t)) score += 3;
          if (hay.includes(t)) score += 1;
        }
        return { f, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((x) => x.f);
    return scored;
  }, [query]);

  const toggle = (index: number) => {
    setOpenIndex((current) => (current === index ? null : index));
  };

  return (
    <div className="h-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mb-8">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" strokeWidth={1.75} />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenIndex(null);
            }}
            placeholder="Search for a question"
            className="w-full pl-14 pr-5 py-3.5 rounded-full bg-white border border-white text-slate-900 placeholder:text-slate-400 text-[15px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            aria-label="Search FAQs"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-slate-500 py-12">
          No FAQs match "{query}". Try a different keyword.
        </p>
      ) : (
        <div className="divide-y divide-slate-200">
          {filtered.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={faq.question} className="py-0">
                <button
                  onClick={() => toggle(index)}
                  className="w-full flex items-center justify-between gap-4 py-4 px-4 text-left group"
                  aria-expanded={isOpen}
                >
                  <span
                    className="text-[15px] sm:text-[16px] font-medium leading-snug text-slate-900 group-hover:text-[#2196F3] transition-colors"
                    style={{ letterSpacing: "-0.01em" }}
                  >
                    {faq.question}
                  </span>
                  <ChevronDown
                    className={`shrink-0 w-4 h-4 text-slate-400 transition-transform duration-300 ${
                      isOpen ? "rotate-180 text-[#2196F3]" : ""
                    }`}
                    strokeWidth={1.75}
                  />
                </button>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="pb-4 px-4 text-[14px] leading-[1.65] text-slate-500">
                      {faq.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ContactUsFAQSection;
