
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Home from "./Home.jsx";
import Login from "./Login.jsx";
import { isAuthenticated } from "./auth.js";

const queryClient = new QueryClient();

const RequireAuth = ({ children }) =>
  isAuthenticated() ? children : <Navigate to="/" replace />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route
            path="/home"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  </QueryClientProvider>
);

export default App;
