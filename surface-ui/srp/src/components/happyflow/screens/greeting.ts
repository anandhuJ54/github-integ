/** "Good morning" / "Good afternoon" / "Good evening" for the viewer's local time. */
export function greeting(): string {
  const hr = new Date().getHours();
  return hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
}
