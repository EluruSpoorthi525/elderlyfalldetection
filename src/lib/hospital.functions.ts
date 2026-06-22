import { createServerFn } from "@tanstack/react-start";

export interface NearestHospital {
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  mapsUrl: string;
  phone?: string;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const findNearestHospital = createServerFn({ method: "POST" })
  .inputValidator((data: { lat: number; lng: number }) => {
    if (typeof data?.lat !== "number" || typeof data?.lng !== "number") {
      throw new Error("lat and lng required");
    }
    return data;
  })
  .handler(async ({ data }): Promise<{ hospital: NearestHospital | null; error?: string }> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gmapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !gmapsKey) {
      return { hospital: null, error: "Maps not configured" };
    }
    try {
      const res = await fetch(
        "https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchNearby",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "X-Connection-Api-Key": gmapsKey,
            "Content-Type": "application/json",
            "X-Goog-FieldMask":
              "places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber",
          },
          body: JSON.stringify({
            includedTypes: ["hospital"],
            maxResultCount: 5,
            rankPreference: "DISTANCE",
            locationRestriction: {
              circle: {
                center: { latitude: data.lat, longitude: data.lng },
                radius: 20000,
              },
            },
          }),
        },
      );
      if (!res.ok) {
        return { hospital: null, error: `Places error ${res.status}` };
      }
      const body = (await res.json()) as {
        places?: Array<{
          displayName?: { text?: string };
          formattedAddress?: string;
          location?: { latitude: number; longitude: number };
          nationalPhoneNumber?: string;
        }>;
      };
      const first = body.places?.[0];
      if (!first?.location) return { hospital: null, error: "No hospitals nearby" };
      const lat = first.location.latitude;
      const lng = first.location.longitude;
      const distanceKm = haversineKm({ lat: data.lat, lng: data.lng }, { lat, lng });
      return {
        hospital: {
          name: first.displayName?.text ?? "Nearest hospital",
          address: first.formattedAddress ?? "",
          lat,
          lng,
          distanceKm,
          phone: first.nationalPhoneNumber,
          mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
        },
      };
    } catch (e) {
      return { hospital: null, error: e instanceof Error ? e.message : "Lookup failed" };
    }
  });
