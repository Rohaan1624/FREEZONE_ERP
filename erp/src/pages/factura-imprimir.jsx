import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Printer, Download, FileText, PackageCheck, CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { usd, n2, n0, fecha } from "@/lib/format"
import { mul, sumar, centavos } from "@/lib/dinero"

/**
 * Printable documents. No PDF library: the browser's own print dialog produces
 * a better PDF than any bundled renderer, honours the system's paper size, and
 * costs nothing in bundle weight. "Guardar como PDF" is the destination.
 *
 * The suggested filename comes from document.title, so it is swapped to
 * "Factura 1208-26" / "PackingList 1208-26" just before printing and restored
 * afterwards. Slashes are stripped — they are path separators in a filename.
 *
 * Fields the schema does not have yet (RUC, dirección, orden de compra,
 * vendedor…) are read defensively and simply print blank, exactly as they do
 * on the paper template. Add the columns later and they fill in by themselves.
 */

const nombreArchivo = (prefijo, num) =>
  `${prefijo} ${String(num ?? "").replace(/[\\/:*?"<>|]/g, "-")}`.trim()

export default function FacturaImprimir() {
  const { id } = useParams()
  const [doc, setDoc] = React.useState("factura")
  const [inv, setInv] = React.useState(null)
  const [empresa, setEmpresa] = React.useState(null)
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState("")
  const [generando, setGenerando] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    Promise.all([
      supabase
        .from("invoice")
        .select(
          "*, transaction(*, product(sku,description,unit,weight_kg,cbm)), client(*)"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("company").select("*").maybeSingle(),
    ]).then(([i, c]) => {
      if (!vivo) return
      const e = i.error || c.error
      if (e) setError(e.message)
      setInv(i.data)
      setEmpresa(c.data)
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [id])

  if (cargando) return <div className="p-6 text-sm text-neutral-700">Cargando…</div>
  if (!inv) {
    return (
      <div className="rounded-[22px] bg-newsprint p-10 text-center">
        <div className="text-base font-semibold">Esa factura no existe</div>
        <Link to="/facturas" className="mt-4 inline-block text-[13px] underline underline-offset-2">
          Volver a facturas
        </Link>
      </div>
    )
  }

  const cli = inv.client ?? {}
  const emp = empresa ?? {}
  const lineas = inv.transaction ?? []

  // Charges are money, not goods — they belong on the invoice but never on a
  // packing list, which is what the warehouse checks the boxes against.
  const mercancia = lineas.filter((l) => l.type !== "charge")

  const importe = (l) => centavos(mul(l.qty, l.unit_price))
  const totalBultos = lineas.reduce((t, l) => t + Number(l.bultos ?? 0), 0)
  const totalPeso = mercancia.reduce(
    (t, l) => t + Number(l.qty ?? 0) * Number(l.product?.weight_kg ?? 0),
    0
  )
  const totalCubicaje = mercancia.reduce(
    (t, l) => t + Number(l.qty ?? 0) * Number(l.product?.cbm ?? 0),
    0
  )
  const subtotal = sumar(lineas, importe)

  const terminos = inv.due_date
    ? cli.payment_terms
      ? `Fact. Crédito (${cli.payment_terms} días)`
      : `Vence ${fecha(inv.due_date)}`
    : "Fact. Contado (0 días)"

  const cantidad = (l) =>
    `${n0(l.qty)}${l.unit ? ` ${l.unit}` : l.product?.unit ? ` ${l.product.unit}` : ""}`

  const etiqueta = (l) =>
    l.type === "product" ? l.product?.description || l.product?.sku || "—" : l.description || "—"

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar — never printed */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to={`/facturas/${id}`} className="flex items-center gap-2 text-[13px]">
          <ArrowLeft className="size-4" />
          Volver a la factura
        </Link>
        <div className="ml-auto inline-flex gap-1 rounded-full bg-newsprint p-1">
          {[
            ["factura", "Factura", FileText],
            ["packing", "Packing list", PackageCheck],
          ].map(([k, etiq, Icon]) => (
            <button
              key={k}
              onClick={() => setDoc(k)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px]",
                doc === k ? "bg-ink text-paper" : "text-ink"
              )}
            >
              <Icon className="size-4" />
              {etiq}
            </button>
          ))}
        </div>
        <button
          onClick={async () => {
            setError("")
            setGenerando(true)
            try {
              // Import diferido: los ~150 KB de jsPDF solo se descargan la
              // primera vez que alguien pulsa el botón, no en cada carga.
              const { descargar } = await import("@/lib/pdf")
              descargar(doc, inv, empresa)
            } catch (e) {
              setError(`No se pudo generar el PDF: ${e.message}`)
            } finally {
              setGenerando(false)
            }
          }}
          disabled={generando}
          className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
        >
          <Download className="size-4" />
          {generando ? "Generando…" : "Descargar PDF"}
        </button>
        <button
          onClick={() => window.print()}
          title="Abrir el diálogo de impresión"
          className="grid size-9 place-items-center rounded-full bg-newsprint"
        >
          <Printer className="size-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-newsprint px-4 py-3 text-[13px] print:hidden">
          <CircleAlert className="size-[19px] shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* The sheet. White with a hairline on screen; edge-to-edge on paper. */}
      <div className="hoja mx-auto w-full max-w-[210mm] bg-white p-[14mm] text-ink shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {doc === "factura" ? (
          <>
            <header>
              <h1 className="m-0 text-[26px] font-bold tracking-[-0.01em] uppercase">
                {emp.name ?? "—"}
              </h1>
              <div className="mt-1 text-[12px] leading-[1.5]">
                {emp.tax_id && <div>RUC. {emp.tax_id}</div>}
                {(emp.address ?? "").split("\n").filter(Boolean).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
                <div>
                  {emp.contact ? `TEL: ${emp.contact}` : ""}
                  {emp.contact && emp.email ? " · " : ""}
                  {emp.email ? `E-MAIL: ${emp.email}` : ""}
                </div>
              </div>
            </header>

            <hr className="my-4 border-0 border-t-2 border-ink" />

            <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[12px]">
              {[
                ["Factura No.:", inv.invoice_num, "Orden de Compra:", inv.purchase_order],
                ["Fecha:", fecha(inv.date_created), "Marcas:", inv.marks],
                ["Vendido a:", inv.client_name ?? cli.name, "Consignado a:", inv.consigned_to],
                ["Dirección:", cli.address, "Despachado:", inv.dispatched],
                ["País:", cli.country, "Vendedor:", inv.salesperson],
                ["Términos de Pago:", terminos, "Embarcado vía:", inv.shipped_via],
              ].map(([ka, va, kb, vb], i) => (
                <React.Fragment key={i}>
                  <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
                    <span className="font-bold">{ka}</span>
                    <span>{va || ""}</span>
                  </div>
                  <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
                    <span className="font-bold">{kb}</span>
                    <span>{vb || ""}</span>
                  </div>
                </React.Fragment>
              ))}
            </div>

            <table className="mt-5 w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {["BULTOS", "REFERENCIA", "DESCRIPCIÓN", "CANTIDAD", "PRECIO", "TOTAL"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={cn(
                          "border border-ink px-2 py-1.5 text-center font-bold",
                          i >= 4 && "w-[80px]"
                        )}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td className="border border-ink px-2 py-1.5 tabular-nums">
                      {l.bultos == null ? "" : n0(l.bultos)}
                    </td>
                    <td className="border border-ink px-2 py-1.5 tabular-nums">
                      {l.product?.sku ?? ""}
                    </td>
                    <td className="border border-ink px-2 py-1.5">{etiqueta(l)}</td>
                    <td className="border border-ink px-2 py-1.5 tabular-nums">
                      {l.type === "charge" ? "" : cantidad(l)}
                    </td>
                    <td className="border border-ink px-2 py-1.5 text-right tabular-nums">
                      {usd(l.unit_price)}
                    </td>
                    <td className="border border-ink px-2 py-1.5 text-right tabular-nums">
                      {usd(importe(l))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <hr className="mt-4 mb-2 border-0 border-t-2 border-ink" />

            <div className="flex flex-wrap items-baseline gap-x-10 text-[12px]">
              <span>
                <b>Total Bultos:</b> {n0(totalBultos)}
              </span>
              <span>
                <b>Total Peso:</b> {n2(totalPeso)}
              </span>
              <span className="ml-auto">
                <b>Subtotal:</b> {usd(subtotal)}
              </span>
            </div>
            <div className="mt-2 text-right text-[13px] font-bold">TOTAL: {usd(inv.total)}</div>

            {inv.notes && (
              <div className="mt-6 text-[11px]">
                <b>Notas:</b> {inv.notes}
              </div>
            )}
          </>
        ) : (
          <>
            <header className="text-center">
              <div className="text-[15px] font-bold uppercase">{emp.name ?? "—"}</div>
              <div className="text-[15px] font-bold uppercase">
                Packing List (Lista de Empaque)
              </div>
            </header>

            <div className="mt-4 text-[12px] leading-[1.9]">
              <div>
                <b>NOMBRE:</b> {inv.client_name ?? cli.name ?? ""}
              </div>
              <div className="flex flex-wrap gap-x-12">
                <span>
                  <b>FECHA:</b> {fecha(inv.date_created)}
                </span>
                <span>
                  <b>PEDIDO:</b> {inv.purchase_order ?? ""}
                </span>
                <span>
                  <b>FACTURA:</b> {inv.invoice_num}
                </span>
              </div>
              <div>
                <b>VENDEDOR:</b> {inv.salesperson ?? ""}
              </div>
              <div className="flex flex-wrap gap-x-12">
                <span>
                  <b>DIRECCION:</b> {cli.address ?? ""}
                </span>
                <span>
                  <b>MARCAS:</b> {inv.marks ?? ""}
                </span>
              </div>
            </div>

            <table className="mt-4 w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-y border-ink">
                  {["BULTOS", "PESO", "CUBICAJE", "REFERENCIA", "DESCRIPCION", "CANTIDAD"].map(
                    (h) => (
                      <th key={h} className="px-2 py-1.5 text-center font-bold">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {mercancia.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2 py-1 text-center tabular-nums">
                      {l.bultos == null ? "" : n0(l.bultos)}
                    </td>
                    <td className="px-2 py-1 text-center tabular-nums">
                      {n2(Number(l.qty ?? 0) * Number(l.product?.weight_kg ?? 0))}
                    </td>
                    <td className="px-2 py-1 text-center tabular-nums">
                      {(Number(l.qty ?? 0) * Number(l.product?.cbm ?? 0)).toFixed(1)}
                    </td>
                    <td className="px-2 py-1 text-center tabular-nums">{l.product?.sku ?? ""}</td>
                    <td className="px-2 py-1 text-center">{etiqueta(l)}</td>
                    <td className="px-2 py-1 text-center tabular-nums">{cantidad(l)}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink font-bold">
                  <td className="px-2 py-1 text-center tabular-nums">{n0(totalBultos)}</td>
                  <td className="px-2 py-1 text-center tabular-nums">{n2(totalPeso)}</td>
                  <td className="px-2 py-1 text-center tabular-nums">
                    {totalCubicaje.toFixed(1)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>

            <div className="mt-5 text-center text-[13px] font-bold">
              FIN DE LA LISTA DE EMPAQUE
            </div>

            {/* Signature block — the warehouse copy gets signed by hand */}
            <div className="mt-14 grid grid-cols-4 gap-6 text-center text-[12px] font-bold">
              {["APROBADO POR", "SACADO POR", "VERIFICADO POR", "EMPACADO POR"].map((t) => (
                <div key={t}>
                  <div className="mb-1.5 border-t border-ink" />
                  {t}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="mx-auto max-w-[210mm] text-xs text-neutral-700 print:hidden">
        <b>Descargar PDF</b> genera el archivo directamente como{" "}
        <b>
          {nombreArchivo(doc === "factura" ? "Factura" : "PackingList", inv.invoice_num)}.pdf
        </b>{" "}
        — con texto real, no una captura, así que se puede buscar y copiar. El botón de impresora
        abre el diálogo del navegador por si prefieres mandarlo a papel.
      </p>
    </div>
  )
}
