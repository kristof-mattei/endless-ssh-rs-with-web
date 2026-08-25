import type React from "react";

export const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    return (
        <div className="flex flex-col items-center rounded-lg bg-gray-800 p-4">
            <span className="text-2xl font-bold text-white">{value}</span>
            <span className="mbs-1 text-sm text-gray-400">{label}</span>
        </div>
    );
};
