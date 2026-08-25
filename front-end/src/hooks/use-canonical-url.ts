import { useQueryStates } from "nuqs";
import { useEffect } from "react";

import { DASHBOARD_PARAMS } from "../lib/dashboard-params";

// Writes every dashboard param into the URL once on load, defaults included, so a link copied from
// the address bar states the whole view. Without it a param the visitor never touched stays absent
// and resolves against whatever the default happens to be when the link is opened.
export function useCanonicalUrl(): void {
    const [, setParams] = useQueryStates(DASHBOARD_PARAMS);

    useEffect(() => {
        // replace, so arriving at the page does not leave a history entry that back would step into
        void setParams(
            (current) => {
                return current;
            },
            { history: "replace" },
        );
    }, [setParams]);
}
