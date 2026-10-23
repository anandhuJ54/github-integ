import { Link } from "@/components/marketing/link";
import { Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/marketing/ui/breadcrumb";

interface BreadcrumbParent {
  label: string;
  to: string;
}

const isExternal = (url: string) => /^https?:\/\//.test(url);

/** Shared breadcrumb wrapper — use via PageBreadcrumb on all product pages. */
export const BREADCRUMB_WRAPPER_CLASS =
  "mx-auto hidden w-full max-w-[1320px] px-6 py-5 md:block";

interface PageBreadcrumbProps {
  label: string;
  parents?: BreadcrumbParent[];
}

export const PageBreadcrumb = ({ label, parents = [] }: PageBreadcrumbProps) => {
  return (
    <div className={BREADCRUMB_WRAPPER_CLASS}>
      <Breadcrumb>
        <BreadcrumbList className="text-base">
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <a
                href="https://www.experience.com"
                className="flex items-center gap-2 font-semibold !text-[#262626] hover:!text-[#262626]/80"
              >
                <Home className="h-[1.1em] w-[1.1em] !fill-[#262626] !text-[#262626]" strokeWidth={2} />
                <span>Home</span>
              </a>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {parents.map((parent) => (
            <div key={parent.to} className="flex items-center">
              <BreadcrumbSeparator className="ml-2 text-muted-foreground [&>svg]:hidden">
                /
              </BreadcrumbSeparator>
              <BreadcrumbItem className="ml-2">
                <BreadcrumbLink asChild>
                  {isExternal(parent.to) ? (
                    <a href={parent.to} className="font-medium text-muted-foreground hover:text-primary">
                      {parent.label}
                    </a>
                  ) : (
                    <Link to={parent.to} className="font-medium text-muted-foreground hover:text-primary">
                      {parent.label}
                    </Link>
                  )}
                </BreadcrumbLink>
              </BreadcrumbItem>
            </div>
          ))}
          <BreadcrumbSeparator className="text-muted-foreground [&>svg]:hidden">
            /
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage className="text-muted-foreground">{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
};
