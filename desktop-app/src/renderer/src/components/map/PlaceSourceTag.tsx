/** Small provenance tag on a place suggestion: which data source found it. */
export function PlaceSourceTag({
  source,
}: Readonly<{ source?: "osm" | "overture" }>): React.JSX.Element | null {
  if (!source) return null;
  return (
    <span className="ml-auto shrink-0 self-center rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
      {source === "osm" ? "OSM" : "Overture"}
    </span>
  );
}
