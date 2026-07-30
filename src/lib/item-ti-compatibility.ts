export type ItemTiFormat = "standard" | "non_standard";

type ItemTiFormatSource = {
  item_no?: string | null;
  ti_format?: string | null;
};

export function normalizeItemNo(itemNo?: string | null) {
  return String(itemNo || "").replace(/[\s,\.]+/g, "").replace(/[^0-9]/g, "");
}

export function normalizeItemTiFormat(format?: string | null): ItemTiFormat {
  return format === "non_standard" ? "non_standard" : "standard";
}

export function getItemTiFormat(item?: ItemTiFormatSource | null): ItemTiFormat {
  return normalizeItemTiFormat(item?.ti_format);
}

export function isItemStandardTiCompatible(item?: ItemTiFormatSource | null) {
  return getItemTiFormat(item) !== "non_standard";
}

export function buildItemTiFormatMap(items?: ItemTiFormatSource[] | null) {
  return Object.fromEntries(
    (items || []).map((item) => [normalizeItemNo(item.item_no), getItemTiFormat(item)])
  ) as Record<string, ItemTiFormat>;
}
