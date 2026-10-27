import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ConversationView from "../components/ConversationView";
import { Card, ErrorAlert } from "../components/ui";

/** Full-page, shareable conversation view. */
export default function ConversationPage() {
  const [sp] = useSearchParams();
  const table = sp.get("table");
  const sessions = sp.get("sessions");
  if (!table || !sessions) return <ErrorAlert error="Missing table or sessions in URL." />;
  return (
    <div className="space-y-4">
      <Link to="/conversations" className="btn-ghost !px-0"><ArrowLeft className="h-4 w-4" /> Back to conversations</Link>
      <Card bodyClass="p-6">
        <ConversationView table={table} sessions={sessions} start={sp.get("start")} end={sp.get("end")} q={sp.get("q") || ""} />
      </Card>
    </div>
  );
}
