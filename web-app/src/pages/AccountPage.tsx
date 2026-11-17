import { useNavigate } from "react-router";
import { Button } from "../components/Button";
import { PageHeading } from "../components/PageHeading";
import { usePlayer } from "../hooks/usePlayer";

export function AccountPage(): React.JSX.Element {
  const { player, signOut } = usePlayer();
  const navigate = useNavigate();
  return (
    <main>
      <PageHeading title="Account" lead={player?.email} />
      <Button
        variant="secondary"
        onClick={() => {
          void signOut().then(() => navigate("/"));
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
