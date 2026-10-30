import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login.tsx";
import Register from "./pages/Register.tsx";
import Overview from "./pages/dashboard/Overview.tsx";
import Upload from "./pages/dashboard/Upload.tsx";
import Requests from "./pages/dashboard/Requests.tsx";
import AccessControl from "./pages/dashboard/AccessControl.tsx";
import Audit from "./pages/dashboard/Audit.tsx";
import Verification from "./pages/dashboard/Verification.tsx";
import Provenance from "./pages/dashboard/Provenance.tsx";
import MisuseEvents from "./pages/dashboard/MisuseEvents.tsx";
import MisuseIncident from "./pages/dashboard/MisuseIncident.tsx";
import WatermarkTesting from "./pages/dashboard/WatermarkTesting.tsx";

import { ResearcherLayout } from "@/components/researcher/ResearcherLayout";
import DashboardOverview from "./pages/researcher/DashboardOverview";
import AvailableDatasets from "./pages/researcher/AvailableDatasets";
import MyRequests from "./pages/researcher/MyRequests";
import AccessedData from "./pages/researcher/AccessedData";
import AuditLogs from "./pages/researcher/AuditLogs";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import ResearcherSettings from "./pages/ResearcherSettings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/dashboard" element={<DashboardLayout />}>
                <Route index element={<Overview />} />
                <Route path="upload" element={<Upload />} />
                <Route path="requests" element={<Requests />} />
                <Route path="access" element={<AccessControl />} />
                <Route path="audit" element={<Audit />} />
                <Route path="verification" element={<Verification />} />
                <Route path="profile" element={<Profile />} />
                <Route path="settings" element={<Settings />} />
                <Route path="provenance" element={<Provenance />} />
                <Route path="misuse" element={<MisuseEvents />} />
                <Route path="misuse/:eventId" element={<MisuseIncident />} />
                <Route path="watermark-testing" element={<WatermarkTesting />} />
              </Route>

              <Route path="/researcher" element={<ResearcherLayout />}>
                <Route index element={<DashboardOverview />} />
                <Route path="datasets" element={<AvailableDatasets />} />
                <Route path="requests" element={<MyRequests />} />
                <Route path="accessed" element={<AccessedData />} />
                <Route path="audit" element={<AuditLogs />} />
                <Route path="profile" element={<Profile />} />
                <Route path="settings" element={<ResearcherSettings />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
