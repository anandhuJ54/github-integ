import type { ShellUrlConfig } from "@v3/shared/public/types/shell";

const DEFAULT_PRO_API = "https://proapi.experience.com";
const DEFAULT_SEARCH_BASE = "https://www.experience.com";
const DEFAULT_APP_BASE = "https://app.experience.com";
const DEFAULT_PRO_BASE = "https://www.experience.com";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function readEnv(key: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[key]?.trim();
  return value || undefined;
}

/** Shell URL config from child-pages .env — pass to SharedHeader / SharedFooter. */
export function getShellUrls(): ShellUrlConfig {
  return {
    proApiUrl: readEnv("VITE_PRO_API_URL"),
    searchBaseUrl: readEnv("VITE_SEARCH_BASE_URL"),
    appBaseUrl: readEnv("VITE_APP_BASE_URL"),
    proBaseUrl: readEnv("VITE_PRO_BASE_URL"),
  };
}

/** Pro API base URL (search autocomplete). */
export function getProApiBaseUrl(): string {
  return trimTrailingSlash(readEnv("VITE_PRO_API_URL") ?? DEFAULT_PRO_API);
}

/** Where search submits redirect. */
export function getSearchBaseUrl(): string {
  return trimTrailingSlash(readEnv("VITE_SEARCH_BASE_URL") ?? DEFAULT_SEARCH_BASE);
}

/** App URLs — login, signup, dashboard. */
export function getAppBaseUrl(): string {
  return trimTrailingSlash(readEnv("VITE_APP_BASE_URL") ?? DEFAULT_APP_BASE);
}

/** Marketing / product nav links. */
export function getProBaseUrl(): string {
  return trimTrailingSlash(readEnv("VITE_PRO_BASE_URL") ?? DEFAULT_PRO_BASE);
}

export function getSignUpUrl(utmQuery = ""): string {
  if (!utmQuery) return `${getAppBaseUrl()}/user/signup`;
  const query = utmQuery.startsWith("?") ? utmQuery : `?${utmQuery}`;
  return `${getAppBaseUrl()}/user/signup${query}`;
}

export function getRequestDemoUrl(): string {
  return `${getProBaseUrl()}/request-a-demo`;
}

export function getWatchDemoUrl(): string {
  return `${getProBaseUrl()}/watch-a-demo`;
}
