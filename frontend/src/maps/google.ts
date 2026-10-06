import type { Geocoder, LatLng, PlaceSearch, PlaceSuggestion, RouteAlternative, RouteService } from "./types";

// Google implementations. They only run once the Maps script is loaded by APIProvider.
// They are not exercised by the test suite, which uses fakes.

export const googleGeocoder: Geocoder = {
  async reverse(point: LatLng): Promise<string | null> {
    const geocoder = new google.maps.Geocoder();
    const { results } = await geocoder.geocode({ location: point });
    return results[0]?.formatted_address ?? null;
  },
};

export const googlePlaceSearch: PlaceSearch = {
  async suggest(query: string, sessionToken: string): Promise<PlaceSuggestion[]> {
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary("places");
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query,
      includedRegionCodes: ["gb"],
      sessionToken: sessionToken ? new AutocompleteSessionToken() : undefined,
    });
    return suggestions.flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      return prediction ? [{ placeId: prediction.placeId, text: prediction.text.text }] : [];
    });
  },
  async resolve(placeId: string): Promise<{ location: LatLng; name: string } | null> {
    const { Place } = await google.maps.importLibrary("places");
    const place = new Place({ id: placeId });
    await place.fetchFields({ fields: ["location", "displayName", "formattedAddress"] });
    const location = place.location;
    if (!location) return null;
    return {
      location: { lat: location.lat(), lng: location.lng() },
      name: place.displayName ?? place.formattedAddress ?? "Selected place",
    };
  },
};

// The Routes library types are not in @types/google.maps 3.58, so the shape used here is written out.
interface RoutePoint {
  lat(): number;
  lng(): number;
}
interface RouteResult {
  path?: RoutePoint[];
  distanceMeters?: number;
  durationMillis?: number;
  description?: string;
}
interface RoutesLibrary {
  Route: {
    computeRoutes(request: Record<string, unknown>): Promise<{ routes: RouteResult[] }>;
  };
}

export const googleRouteService: RouteService = {
  async alternatives(origin: LatLng, destination: LatLng): Promise<RouteAlternative[]> {
    const library = (await google.maps.importLibrary("routes")) as unknown as RoutesLibrary;
    const { routes } = await library.Route.computeRoutes({
      origin,
      destination,
      travelMode: "DRIVING",
      computeAlternativeRoutes: true,
      fields: ["path", "distanceMeters", "durationMillis", "description"],
    });
    return routes.slice(0, 3).map((route, index) => ({
      name: route.description || `Route ${String.fromCharCode(65 + index)}`,
      distanceM: route.distanceMeters ?? 0,
      durationS: (route.durationMillis ?? 0) / 1000,
      path: (route.path ?? []).map((point) => ({ lat: point.lat(), lng: point.lng() })),
    }));
  },
};
