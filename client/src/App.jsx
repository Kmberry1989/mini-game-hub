import React, { useState } from "react";
import StudioGame from "./StudioGame";

export default function App() {
    const [join, setJoin] = useState(false);

    if (!join) {
        return (
            <div style={{ height: "100vh", display: "grid", placeItems: "center" }}>
                <button onClick={() => setJoin(true)}>
                    Enter Cozy Studio
                </button>
            </div>
        );
    }

    return <StudioGame />;
}