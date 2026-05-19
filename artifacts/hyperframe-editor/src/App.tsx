import { Switch, Route, Router as WouterRouter } from "wouter";
import Home from "@/pages/home";
import EditorPage from "@/pages/editor";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/editor/:id">
        {(params) => <EditorPage id={params.id} />}
      </Route>
      <Route>
        <div className="p-8 opacity-60">Page not found.</div>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}

export default App;
