import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell.jsx';
import { usePulseLive } from './hooks/usePulseLive.js';
import { IssueDetail } from './pages/IssueDetail.jsx';
import { IssuesPage } from './pages/IssuesPage.jsx';
import { LivePage } from './pages/LivePage.jsx';
import { SetupPage } from './pages/SetupPage.jsx';

export default function App() {
  const [liveEvents, setLiveEvents] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  usePulseLive((payload) => {
    if (payload?.event) {
      setLiveEvents((current) => [payload, ...current].slice(0, 50));
    }
    setRefreshKey((value) => value + 1);
  });

  return (
    <Shell liveCount={liveEvents.length}>
      <Routes>
        <Route path="/" element={<IssuesPage refreshKey={refreshKey} view="open" />} />
        <Route path="/fixed" element={<IssuesPage refreshKey={refreshKey} view="fixed" />} />
        <Route path="/pulls" element={<IssuesPage refreshKey={refreshKey} view="create-pull" />} />
        <Route path="/merged" element={<IssuesPage refreshKey={refreshKey} view="merge-pull" />} />
        <Route path="/closed" element={<IssuesPage refreshKey={refreshKey} view="closed-pull" />} />
        <Route path="/issues/:id" element={<IssueDetail />} />
        <Route path="/live" element={<LivePage events={liveEvents} />} />
        <Route path="/setup" element={<SetupPage />} />
      </Routes>
    </Shell>
  );
}
