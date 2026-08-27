import { Routes, Route, Navigate } from 'react-router-dom'

import { AuthProvider } from '@/lib/auth'
import { AppShell } from '@/components/app-shell'
import Login from '@/pages/login'
import Facturas from '@/pages/facturas'
import FacturaForm from '@/pages/factura-form'
import NuevaClave from '@/pages/nueva-clave'
import Empresa from '@/pages/empresa'
import Clientes from '@/pages/clientes'
import Cliente from '@/pages/cliente'
import Productos from '@/pages/productos'
import Producto from '@/pages/producto'
import Factura from '@/pages/factura'
import FacturaImprimir from '@/pages/factura-imprimir'
import Entradas from '@/pages/entradas'
import Entrada from '@/pages/entrada'
import Ajustes from '@/pages/ajustes'
import Resumen from '@/pages/resumen'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Target of the password-reset email link */}
        <Route path="/nueva-clave" element={<NuevaClave />} />

        {/* AppShell redirects to /login when there is no session */}
        <Route element={<AppShell />}>
          <Route index element={<Resumen />} />
          <Route path="facturas" element={<Facturas />} />
          <Route path="facturas/nueva" element={<FacturaForm />} />
          <Route path="facturas/:id" element={<Factura />} />
          <Route path="facturas/:id/editar" element={<FacturaForm />} />
          <Route path="facturas/:id/imprimir" element={<FacturaImprimir />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="clientes/:id" element={<Cliente />} />
          <Route path="productos" element={<Productos />} />
          <Route path="productos/:id" element={<Producto />} />
          <Route path="entradas" element={<Entradas />} />
          <Route path="entradas/nueva" element={<Entrada />} />
          <Route path="entradas/ajustes" element={<Ajustes />} />
          <Route path="entradas/:id" element={<Entrada />} />
          <Route path="empresa" element={<Empresa />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
