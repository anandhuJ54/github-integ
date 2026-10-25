import { ArrowRight, Play, Star, CheckCircle } from "lucide-react";
import demoHeroBg from "@v3/marketing/assets/demo-hero-bg.jpg";
import { Button } from "@v3/marketing/components/marketing/ui/button";

const Demo = () => {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section
        className="relative py-20 lg:py-32 overflow-hidden bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${demoHeroBg})` }}
      >
        <div className="absolute inset-0 bg-white/80" aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-6 sm:px-10 lg:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-sm font-medium mb-6">
              Demo in progress
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-slate-900 tracking-tight mb-6">
              See the platform in action
            </h1>
            <p className="text-lg sm:text-xl text-slate-600 mb-8 leading-relaxed">
              Explore how our solutions help businesses grow faster, manage reputation, and drive measurable results.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-6 text-base font-medium group">
                It's Free - sign up today
                <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button
                variant="outline"
                className="rounded-full px-8 py-6 text-base font-medium border-slate-200 hover:bg-white/80 bg-white/60"
              >
                <Play className="mr-2 h-4 w-4" />
                Watch Video
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 mb-4">
              Key Explanation
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              A preview of what you can accomplish with our platform
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: "Search Optimization",
                description:
                  "Improve visibility across every major search engine and directory.",
              },
              {
                title: "Campaign Management",
                description:
                  "Monitor, respond, and grow your reputation from one place.",
              },
              {
                title: "Platform Insights",
                description:
                  "Turn feedback and analytics into actionable business intelligence.",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mb-6">
                  <Star className="h-5 w-5 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-slate-600 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: "10K+", label: "Active Users" },
              { value: "500+", label: "Enterprise Clients" },
              { value: "99.9%", label: "Uptime" },
              { value: "24/7", label: "Support" },
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-blue-600 mb-2">
                  {stat.value}
                </div>
                <div className="text-slate-600 font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Checklist Section */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-semibold text-slate-900 mb-8 text-center">
              What you get
            </h2>
            <div className="space-y-4">
              {[
                "Full access to all platform features",
                "Dedicated onboarding specialist",
                "Custom reporting and dashboards",
                "API access for integrations",
                "Priority support channel",
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 bg-white rounded-xl p-5 shadow-sm border border-slate-100"
                >
                  <CheckCircle className="h-6 w-6 text-blue-600 flex-shrink-0" />
                  <span className="text-lg text-slate-700 font-medium">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-8">
          <div className="bg-blue-600 rounded-3xl p-12 lg:p-20 text-center">
            <h2 className="text-3xl sm:text-4xl font-semibold text-white mb-4">
              Ready to get started?
            </h2>
            <p className="text-blue-100 text-lg mb-8 max-w-2xl mx-auto">
              Join thousands of businesses already growing with our platform.
            </p>
            <Button className="rounded-full bg-white text-blue-600 hover:bg-blue-50 px-8 py-6 text-base font-medium group">
              It's Free - sign up today
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Demo;
