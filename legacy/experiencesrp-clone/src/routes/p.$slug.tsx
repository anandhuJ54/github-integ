import { createFileRoute, notFound } from "@tanstack/react-router";
import { loadProfessionalBundle } from "@/lib/profile-render";
import { CategoryProfile, profileHead } from "@/components/profile/category-profile";

export const Route = createFileRoute("/p/$slug")({
  loader: async ({ params }) => {
    const bundle = await loadProfessionalBundle(params.slug);
    if (!bundle) throw notFound();
    return bundle;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Profile unavailable" }, { name: "robots", content: "noindex" }] };
    }
    return profileHead(loaderData);
  },
  component: ProfessionalProfilePage,
});

function ProfessionalProfilePage() {
  return <CategoryProfile bundle={Route.useLoaderData()} />;
}
