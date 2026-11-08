export type Kind = "barcode" | "weighted" | "free";

export interface Item {
  id: string;
  text: string;
  /** units for barcode items, kilograms for weighted items */
  qty: number;
  kind: Kind;
  barcode?: string;
  keyword?: string;
  exclude?: string;
  checked: boolean;
  /** display names, set by the person who added the item / put it in the cart */
  addedBy?: string;
  checkedBy?: string;
  createdAt?: string;
}

export interface Store {
  key: string;
  chain: string;
  chainName: string;
  name: string;
  address: string;
  band: string;
  approx: boolean;
  items: number;
}

export interface Meta {
  date: string;
  stores: number;
  barcodes: number;
  missing: { key: string; name: string; reason: string }[];
}

export interface Data {
  stores: Store[];
  /** barcode -> price in agorot per store index (null = not sold) */
  prices: Record<string, (number | null)[]>;
  names: Record<string, string>;
  /** per store index: [name, agorot per kg] */
  weighted: [string, number][][];
  meta: Meta;
}
