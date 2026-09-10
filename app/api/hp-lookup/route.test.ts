import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const hpResponse = (body: Record<string, unknown>) => new Response(JSON.stringify({
  TransactionID: "test-transaction",
  Status: { Code: "S-0001", Message: "Transaction completed successfully" },
  Body: body,
}), { status: 200, headers: { "Content-Type": "application/json" } });

describe("HP lookup route multiple-product flow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selects the unique workbook model candidate and loads its serial-specific BOM", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(hpResponse({
        SNRProductLists: [
          { product_Id: "8M4X3AV", product_Desc: "BU IDS UMA U7-155U RTKUSBC 840 G11" },
          { product_Id: "K9H95EA", product_Desc: "H350G2U34030UQX500NXNCN04NNPa ALL" },
        ],
      }))
      .mockResolvedValueOnce(hpResponse({
        ProductBOM: [],
        SerialNumberBOM: {
          wwsnrsinput: {
            product_no: "8M4X3AV",
            user_name: "BU IDS UMA U7-155U RTKUSBC 840 G11",
            serial_number: "5CG5124NY0",
          },
          unit_configuration: [
            { part_number: "N55464-N30", part_description: "IC,uP,I,MTL-U,Ultra 7 155U,1.7GHz,15W", quantity: "1" },
            { part_number: "N20974-983", part_description: "SODIMM 32GB DDR5-5600 Sam D1b E", quantity: "1" },
          ],
          spare_part: [],
          roHS_unit_status: { rohs_status_code: "Duty-To-Declare" },
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/hp-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "5CG5124NY0", modelHint: "HP ELITEBOOK 840 G11" }),
    }));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      productNumber: "8M4X3AV",
      cpu: "Intel Core Ultra 7 155U, 1.7 GHz, 15 W",
      ram: "32 GB, DDR5-5600, SODIMM",
      validationStatus: "supported",
      found: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/ProductNumber/8M4X3AV/country/MY/");
  });
});
