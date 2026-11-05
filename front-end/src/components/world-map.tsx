import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/world-map.css";
import type React from "react";
import { Map, Marker } from "react-map-gl/maplibre";

import type { ActiveConnectionInfo } from "../generated/ActiveConnectionInfo";
import type { Coordinates } from "../generated/Coordinates";
import { useColorScheme } from "../hooks/use-theme";
import type { ColorScheme } from "../lib/theme-preference";

const MAP_STYLES: Record<ColorScheme, string> = {
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

interface Properties {
    activeConnections: ActiveConnectionInfo[];
}

export const WorldMap: React.FC<Properties> = ({ activeConnections }) => {
    const colorScheme = useColorScheme();

    const dots = activeConnections.filter(
        (connection): connection is { coordinates: Coordinates } & ActiveConnectionInfo => {
            return connection.coordinates !== null;
        },
    );

    return (
        <div className="overflow-hidden rounded-lg inline-full" style={{ height: "350px" }}>
            <Map
                attributionControl={{ compact: true }}
                initialViewState={{ longitude: 0, latitude: 20, zoom: 1 }}
                mapStyle={MAP_STYLES[colorScheme]}
                style={{ width: "100%", height: "100%" }}
            >
                {dots.map((dot) => {
                    return (
                        <Marker
                            key={`${dot.ip}:${dot.port}`}
                            latitude={dot.coordinates.latitude}
                            longitude={dot.coordinates.longitude}
                        >
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
