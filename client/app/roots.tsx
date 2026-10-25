import { useMap } from "../lib/use-map";
import { Composer } from "./composer";
import { LeftPane } from "./left-pane";
import { RightPane } from "./right-pane";

/** One React root for each place where state lives (#werk-stack-hydration). */
export function LeftRoot() {
  return <LeftPane map={useMap()} />;
}

export function RightRoot() {
  return (
    <RightPane>
      <Composer />
    </RightPane>
  );
}
