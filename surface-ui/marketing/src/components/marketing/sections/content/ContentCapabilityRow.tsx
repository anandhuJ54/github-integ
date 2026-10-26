import { LucideIcon } from "lucide-react";

interface Bullet {
  icon: LucideIcon;
  text: string;
}

interface ContentCapabilityRowProps {
  headline: string;
  description: string;
  bullets: Bullet[];
  image: string;
  alt: string;
  reverse?: boolean;
  background?: "light" | "white";
}

export const ContentCapabilityRow = ({
  headline,
  description,
  bullets,
  image,
  alt,
  reverse = false,
  background = "white",
}: ContentCapabilityRowProps) => {
  const bg =
    background === "light"
      ? "bg-gradient-to-br from-blue-50 via-background to-purple-50"
      : "bg-background";

  return (
    <section className={`py-12 sm:py-16 lg:py-20 px-4 relative overflow-hidden ${bg}`}>
      <div className="container mx-auto max-w-7xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Content */}
          <div className={`${reverse ? "order-2 lg:order-2 lg:pl-[40px]" : "order-2 lg:order-1 lg:pr-[40px] lg:max-w-[calc(100%-10px)]"} space-y-4`}>
            <h3 className="font-heading text-3xl sm:text-3xl lg:text-[42px] lg:leading-[1.1] text-foreground leading-[1.15]">
              {headline}
            </h3>
            <p className="font-body-light text-base sm:text-lg text-muted-foreground leading-relaxed">
              {description}
            </p>

            {/* Mobile image below subtext */}
            <div className="md:hidden w-full">
              <img src={image} alt={alt} className="w-full h-auto" />
            </div>

            <ul className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 gap-2 sm:gap-3 pt-2">
              {bullets.map((bullet) => {
                const Icon = bullet.icon;
                return (
                  <li key={bullet.text} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(26, 143, 241, 0.12)' }}>
                      <Icon className="w-5 h-5" style={{ color: '#1a8ff1' }} />
                    </div>
                    <span className="text-sm md:text-base font-medium text-foreground sm:font-normal sm:text-muted-foreground">{bullet.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Image (tablet + desktop) */}
          <div className={`hidden md:flex ${reverse ? "order-1 lg:order-1 md:justify-center lg:block lg:-ml-[15%]" : "order-1 lg:order-2 md:justify-center lg:block lg:-mr-[10%]"}`}>
            <img
              src={image}
              alt={alt}
              className="w-full lg:w-[115%] lg:max-w-none h-auto"
            />
          </div>
        </div>
      </div>
    </section>
  );
};
