import type React from "react";
import type { FallbackProps } from "react-error-boundary";
import { getErrorMessage } from "react-error-boundary";

export const SectionError: React.FC<FallbackProps> = ({ error, resetErrorBoundary }) => {
    const message = getErrorMessage(error);

    return (
        <div className="rounded-lg bg-panel p-4 text-sm text-red-fg" role="alert">
            {message === undefined ? "Failed to render this section." : `Failed to render this section: ${message}.`}{" "}
            <button
                className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                onClick={() => {
                    resetErrorBoundary();
                }}
                type="button"
            >
                Retry
            </button>
        </div>
    );
};
