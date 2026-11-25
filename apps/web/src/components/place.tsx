"use client";

import { MapPin } from "@phosphor-icons/react";
import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { placeLinks } from "@/lib/maps";

/**
 * Places on events and tasks, as links to Google Maps. A trip such as
 * "Home → HPN" opens as directions, from the home address saved in Settings.
 */

/** A small pin in front of a place that opens in Google Maps, sized to the text around it. */
const pin = <MapPin aria-hidden size="1em" className="mr-0.5 inline-block align-[-0.125em]" />;

function useHome(): string | undefined {
  return useQuery(api.viewer.settings)?.homeAddress;
}

/** The place as a link that opens it in Google Maps; plain words when it is not on a map. */
export function PlaceLink({ location, className = "underline-offset-2 hover:underline" }: { location: string; className?: string }) {
  const links = placeLinks(location, useHome());
  if (!links) return <>{location}</>;
  return (
    <a href={links.open} target="_blank" rel="noreferrer" className={className} title="Open in Google Maps">
      {pin}
      {location}
    </a>
  );
}

/** For an item's window: the place, and directions there from wherever the owner is. */
export function PlaceFact({ location }: { location: string }) {
  const links = placeLinks(location, useHome());
  if (!links) return <>{location}</>;
  const link = "underline underline-offset-2";
  return (
    <span>
      <a href={links.open} target="_blank" rel="noreferrer" className={link} title="Open in Google Maps">
        {pin}
        {location}
      </a>
      {links.directions ? (
        <>
          {" · "}
          <a href={links.directions} target="_blank" rel="noreferrer" className={link}>
            Directions
          </a>
        </>
      ) : null}
    </span>
  );
}
