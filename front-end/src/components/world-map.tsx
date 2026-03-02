import "maplibre-gl/dist/maplibre-gl.css";

import type React from "react";
import { Map, Marker } from "react-map-gl/maplibre";

import type { ActiveConnection } from "@/hooks/use-web-sockets";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

interface Properties {
    activeConnections: ActiveConnection[];
}

export const WorldMap: React.FC<Properties> = ({ activeConnections }) => {
    const dots = activeConnections.filter((c): c is { lat: number; lon: number } & ActiveConnection => {
        return c.lat !== null && c.lon !== null;
    });

    return (
        <div className="w-full overflow-hidden rounded-lg" style={{ height: "350px" }}>
            <Map
                initialViewState={{ longitude: 0, latitude: 20, zoom: 1 }}
                mapStyle={MAP_STYLE}
                style={{ width: "100%", height: "100%" }}
                attributionControl={false}
            >
                {dots.map((dot) => {
                    return (
                        <Marker key={`${dot.ip}-${dot.connected_at}`} longitude={dot.lon} latitude={dot.lat}>
                            <div
                                style={{
                                    width: "8px",
                                    height: "8px",
                                    borderRadius: "50%",
                                    background: "rgba(239,68,68,0.8)",
                                    border: "1px solid #fca5a5",
                                }}
                            />
                        </Marker>
                    );
                })}
            </Map>
        </div>
    );
};
