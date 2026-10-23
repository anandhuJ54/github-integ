import React from 'react';

// Import client logos
import movementMortgageLogo from "@v3/marketing/assets/client-logos/movement-mortgage.png";
import nafLogo from "@v3/marketing/assets/client-logos/naf.png";
import victoryAffiliatesLogo from "@v3/marketing/assets/client-logos/victory-affiliates.png";
import bhhsLogo from "@v3/marketing/assets/client-logos/bhhs.png";
import fairwayMortgageLogo from "@v3/marketing/assets/client-logos/fairway-mortgage.png";
import magnoliaRealtyLogo from "@v3/marketing/assets/client-logos/magnolia-realty.png";
import crosscountryMortgageLogo from "@v3/marketing/assets/client-logos/crosscountry-mortgage.png";
import wfgNationalTitleLogo from "@v3/marketing/assets/client-logos/wfg-national-title.png";
import fuscoOrsiniLogo from "@v3/marketing/assets/client-logos/fusco-orsini.webp";


// Client logos array
const clientLogos = [
  { name: "NAF", src: nafLogo },
  { name: "CrossCountry Mortgage", src: crosscountryMortgageLogo },
  { name: "Magnolia Realty", src: magnoliaRealtyLogo },
  { name: "Movement Mortgage", src: movementMortgageLogo },
  { name: "WFG National Title", src: wfgNationalTitleLogo },
  { name: "Victory Affiliates", src: victoryAffiliatesLogo },
  { name: "Fairway Home Mortgage", src: fairwayMortgageLogo },
  { name: "Berkshire Hathaway HomeServices", src: bhhsLogo },
];

export const CustomerStoriesLogoSlider = () => {
  return (
    <div className="w-full bg-[hsl(var(--muted))] py-6 md:py-8 overflow-hidden">
      {/* Logo slider with fade mask */}
      <div 
        className="relative"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        }}
      >
        <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
          {/* First set of logos */}
          {clientLogos.map((logo, i) => (
            <div
              key={`set1-${i}`}
              className="flex-shrink-0 mx-8 md:mx-12 flex items-center justify-center"
            >
              <img 
                src={logo.src} 
                alt={logo.name}
                className="h-8 md:h-10 w-auto object-contain opacity-80 brightness-0"
              />
            </div>
          ))}
          {/* Duplicate set for seamless loop */}
          {clientLogos.map((logo, i) => (
            <div
              key={`set2-${i}`}
              className="flex-shrink-0 mx-8 md:mx-12 flex items-center justify-center"
            >
              <img 
                src={logo.src} 
                alt={logo.name}
                className="h-8 md:h-10 w-auto object-contain opacity-80 brightness-0"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CustomerStoriesLogoSlider;
