import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { UserRoleProvider, useUserRole } from "@/contexts/user-role";

import RaceList from "@/pages/race-list";
import DataCorrection from "@/pages/data-correction";
import ProcessingManagement from "@/pages/processing";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  const { isAdmin } = useUserRole();

  return (
    <Layout>
      <Switch>
        <Route path="/" component={RaceList} />
        <Route path="/races/:raceId" component={DataCorrection} />
        <Route path="/processing">
          {isAdmin ? <ProcessingManagement /> : <Redirect to="/" />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UserRoleProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </UserRoleProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
