// Quick Actions — the one thing an HOD opens this app to do, drawn to the
// client's mock-up (2026-08-19): a big solid-filled rounded plate, the action's
// name under it, and a grey line saying what it is for.
//
// ONE TILE, NOT TWO (client, 2026-08-19: "instead of two gate passes, just
// create one icon, Raise Create Gate Pass"). The pass TYPE used to be chosen
// here, by which tile was pressed, and `/raise` read it out of the query string.
// It is now the first control on the form itself — the mock's two Pass Type
// plates — so the dashboard stops asking a question the next screen asks again.
// `/raise` still honours `?type=`, so an old bookmark lands on the right form.
import React from 'react';
import { Link } from 'react-router-dom';
import HodIcon from './HodIcon';

export default function HodQuickActions(): React.ReactElement {
  return (
    <div className="gb-card gb-quick">
      <h2 className="gb-quick-title">Quick Actions</h2>
      <div className="gb-raise-grid">
        <Link to="/raise" className="gb-raise-tile">
          <HodIcon glyph="documentAdd" tone="blue" shape="tile" />
          <span className="gb-raise-title">Raise Gate Pass</span>
          <span className="gb-raise-note">RGP or NRGP — material out</span>
        </Link>
      </div>
    </div>
  );
}
