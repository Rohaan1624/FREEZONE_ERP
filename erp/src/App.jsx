import { createBrowserRouter, Outlet, Navigate } from "react-router-dom";

import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ASISTENTE_ACTIVO } from "@/lib/banderas";
import Inicio from "@/pages/inicio";
import Login from "@/pages/login";
import Registro from "@/pages/registro";
import Facturas from "@/pages/facturas";
import FacturaForm from "@/pages/factura-form";
import NuevaClave from "@/pages/nueva-clave";
import Empresa from "@/pages/empresa";
import Clientes from "@/pages/clientes";
import Cliente from "@/pages/cliente";
import Productos from "@/pages/productos";
import Producto from "@/pages/producto";
import Factura from "@/pages/factura";
import FacturaImprimir from "@/pages/factura-imprimir";
import Entradas from "@/pages/entradas";
import Entrada from "@/pages/entrada";
import Ajustes from "@/pages/ajustes";
import Resumen from "@/pages/resumen";
import Importar from "@/pages/importar";
import Asistente from "@/pages/asistente";

/**
 * Data router, no <BrowserRouter><Routes>.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL CAMBIO
 * ─────────────────────────────────────────────────────────────────────────────
 * `useBlocker` —lo único que puede frenar el botón ATRÁS del navegador— exige
 * un data router; con el declarativo simplemente no existe. Y sin él, salir de
 * una factura a medio capturar se llevaba el trabajo en silencio.
 *
 * El árbol es plano y no usa loaders ni actions, así que la conversión es
 * mecánica: AuthProvider, que antes envolvía a <Routes>, pasa a ser el
 * elemento de la ruta raíz. No usa hooks de router, así que da igual estar
 * dentro del router — y estando dentro, sus hijos siguen viéndolo igual.
 */
export const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    children: [
      // La raíz es PÚBLICA: la portada que se comparte por WhatsApp.
      { path: "/", element: <Inicio /> },

      {
        element: <Outlet />,
        children: [
          { path: "/login", element: <Login /> },
          { path: "/registro", element: <Registro /> },
          // Target of the password-reset email link
          { path: "/nueva-clave", element: <NuevaClave /> },

          // AppShell redirects to /login when there is no session
          {
            element: <AppShell />,
            children: [
              { path: "resumen", element: <Resumen /> },
              { path: "facturas", element: <Facturas /> },
              { path: "facturas/nueva", element: <FacturaForm /> },
              { path: "facturas/:id", element: <Factura /> },
              { path: "facturas/:id/editar", element: <FacturaForm /> },
              { path: "facturas/:id/imprimir", element: <FacturaImprimir /> },
              { path: "clientes", element: <Clientes /> },
              { path: "clientes/:id", element: <Cliente /> },
              { path: "productos", element: <Productos /> },
              { path: "productos/:id", element: <Producto /> },
              { path: "entradas", element: <Entradas /> },
              { path: "entradas/nueva", element: <Entrada /> },
              { path: "entradas/ajustes", element: <Ajustes /> },
              { path: "entradas/:id", element: <Entrada /> },
              { path: "empresa", element: <Empresa /> },
              { path: "importar", element: <Importar /> },
              // Apagado mientras la cuota de Groq sea de la organización y no
              // por cuenta. Ver lib/banderas.js. Sin la ruta, /asistente cae en
              // el comodín de abajo y redirige al resumen.
              ...(ASISTENTE_ACTIVO
                ? [{ path: "asistente", element: <Asistente /> }]
                : []),
            ],
          },

          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
