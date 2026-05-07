import { useEffect, useRef, useState, useCallback } from "react";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { fetchMaterials, type CalculationRequest, type MaterialOption, type AccessoryItem } from "../utils/api";
import { useUnitSystem } from "../contexts/UnitSystemContext";
import {
  GPM_PER_M3H,
  M3H_PER_GPM,
  FT_PER_M,
  M_PER_FT,
  IN_PER_MM,
  MM_PER_IN,
  SI_DEFAULTS,
  US_DEFAULTS,
} from "../utils/units";
import AccessoriesPicker from "./AccessoriesPicker";

const schema = z.object({
  Q:             z.number().positive("Flow must be > 0"),
  flowUnit:      z.enum(["m3h", "ls", "gpm"]),
  elev_us:       z.number(),
  elev_ds:       z.number(),
  pipe_length:   z.number().positive("Length must be > 0"),
  pipe_diameter: z.number().positive("Diameter must be > 0"),
  material:      z.string().min(1, "Select a material"),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onSubmit: (req: CalculationRequest, pickedItems: AccessoryItem[], K_sum: number) => void;
  loading: boolean;
}

export default function CalculationForm({ onSubmit, loading }: Props) {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const { unitSystem } = useUnitSystem();
  const prevUnitRef = useRef<"SI" | "US">(unitSystem);

  const [pickedItems, setPickedItems] = useState<AccessoryItem[]>([]);
  const [pickedKSum, setPickedKSum] = useState(0);

  const { register, handleSubmit, control, watch, setValue, getValues, formState: { errors } } =
    useForm<FormValues, unknown, FormValues>({
      resolver: zodResolver(schema),
      defaultValues: unitSystem === "SI"
        ? { ...SI_DEFAULTS, material: "ductile_iron" }
        : { ...US_DEFAULTS, material: "ductile_iron" },
    });

  const watchedUnit = watch("flowUnit");
  const watchedQ    = watch("Q");

  useEffect(() => {
    fetchMaterials().then(setMaterials).catch(console.error);
  }, []);

  useEffect(() => {
    if (prevUnitRef.current === unitSystem) return;
    const prev = prevUnitRef.current;
    prevUnitRef.current = unitSystem;
    const v = getValues();

    if (prev === "SI" && unitSystem === "US") {
      const Q_m3h = v.flowUnit === "ls" ? v.Q * 3.6 : v.Q;
      setValue("Q",             +( Q_m3h * GPM_PER_M3H ).toFixed(2));
      setValue("flowUnit",      "gpm");
      setValue("elev_us",       +( v.elev_us       * FT_PER_M ).toFixed(2));
      setValue("elev_ds",       +( v.elev_ds       * FT_PER_M ).toFixed(2));
      setValue("pipe_length",   +( v.pipe_length   * FT_PER_M ).toFixed(1));
      setValue("pipe_diameter", +( v.pipe_diameter * IN_PER_MM ).toFixed(3));
    } else if (prev === "US" && unitSystem === "SI") {
      const Q_m3h = v.Q * M3H_PER_GPM;
      setValue("Q",             +( Q_m3h ).toFixed(2));
      setValue("flowUnit",      "m3h");
      setValue("elev_us",       +( v.elev_us       * M_PER_FT ).toFixed(3));
      setValue("elev_ds",       +( v.elev_ds       * M_PER_FT ).toFixed(3));
      setValue("pipe_length",   +( v.pipe_length   * M_PER_FT ).toFixed(1));
      setValue("pipe_diameter", +( v.pipe_diameter * MM_PER_IN ).toFixed(1));
    }
  }, [unitSystem, getValues, setValue]);

  const handlePickerChange = useCallback(
    (items: AccessoryItem[], kSum: number) => {
      setPickedItems(items);
      setPickedKSum(kSum);
    },
    []
  );

  const submit: SubmitHandler<FormValues> = (values) => {
    let Q_m3h: number;
    if (unitSystem === "US") {
      Q_m3h = values.Q * M3H_PER_GPM;
    } else {
      Q_m3h = values.flowUnit === "ls" ? values.Q * 3.6 : values.Q;
    }

    const elev_us_m = unitSystem === "US" ? values.elev_us       * M_PER_FT  : values.elev_us;
    const elev_ds_m = unitSystem === "US" ? values.elev_ds       * M_PER_FT  : values.elev_ds;
    const length_m  = unitSystem === "US" ? values.pipe_length   * M_PER_FT  : values.pipe_length;
    const diam_mm   = unitSystem === "US" ? values.pipe_diameter * MM_PER_IN : values.pipe_diameter;

    onSubmit(
      {
        Q_m3h,
        elev_us_m,
        elev_ds_m,
        pipe_length_m:    length_m,
        pipe_diameter_mm: diam_mm,
        material:         values.material,
        K_values:         pickedItems.flatMap((item) =>
          Array(item.count).fill(item.K_override != null ? item.K_override : 0)
        ),
      },
      pickedItems,
      pickedKSum
    );
  };

  const isUS = unitSystem === "US";

  const inputCls =
    "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
  const labelCls =
    "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";
  const errCls = "mt-0.5 text-xs text-red-600";

  const elevUnit  = isUS ? "ft"  : "m";
  const lengthUnit = isUS ? "ft" : "m";
  const diamUnit  = isUS ? "in"  : "mm";
  const flowLabel = isUS ? "gpm" : watchedUnit === "ls" ? "L/s" : "m³/h";

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">

      {/* Flow with unit toggle */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls + " mb-0"}>Design Flow Q</label>
          <div className="flex rounded overflow-hidden border border-slate-300 text-xs font-mono">
            {isUS ? (
              <span className="px-2 py-0.5 bg-teal-700 text-white">gpm</span>
            ) : (
              <Controller
                control={control}
                name="flowUnit"
                render={({ field }) => (
                  <>
                    <button
                      type="button"
                      onClick={() => field.onChange("m3h")}
                      className={`px-2 py-0.5 transition-colors ${
                        field.value === "m3h"
                          ? "bg-teal-700 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      m³/h
                    </button>
                    <button
                      type="button"
                      onClick={() => field.onChange("ls")}
                      className={`px-2 py-0.5 border-l border-slate-300 transition-colors ${
                        field.value === "ls"
                          ? "bg-teal-700 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      L/s
                    </button>
                  </>
                )}
              />
            )}
          </div>
        </div>
        <div className="relative">
          <input
            {...register("Q", { valueAsNumber: true })}
            type="number"
            step="0.01"
            className={inputCls}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
            {flowLabel}
          </span>
        </div>
        {errors.Q && <p className={errCls}>{errors.Q.message}</p>}
        {!isUS && watchedUnit === "ls" && (
          <p className="mt-0.5 text-xs text-slate-400 font-mono">
            = {((watchedQ || 0) * 3.6).toFixed(2)} m³/h
          </p>
        )}
        {isUS && (
          <p className="mt-0.5 text-xs text-slate-400 font-mono">
            = {((watchedQ || 0) * M3H_PER_GPM).toFixed(2)} m³/h (SI)
          </p>
        )}
      </div>

      {/* Elevations */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Upstream Elevation</label>
          <div className="relative">
            <input
              {...register("elev_us", { valueAsNumber: true })}
              type="number"
              step="0.01"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              {elevUnit}
            </span>
          </div>
          {errors.elev_us && <p className={errCls}>{errors.elev_us.message}</p>}
        </div>
        <div>
          <label className={labelCls}>Downstream Elevation</label>
          <div className="relative">
            <input
              {...register("elev_ds", { valueAsNumber: true })}
              type="number"
              step="0.01"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              {elevUnit}
            </span>
          </div>
          {errors.elev_ds && <p className={errCls}>{errors.elev_ds.message}</p>}
        </div>
      </div>

      {/* Pipe geometry */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Pipe Length L</label>
          <div className="relative">
            <input
              {...register("pipe_length", { valueAsNumber: true })}
              type="number"
              step="1"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              {lengthUnit}
            </span>
          </div>
          {errors.pipe_length && <p className={errCls}>{errors.pipe_length.message}</p>}
        </div>
        <div>
          <label className={labelCls}>Internal Diameter D</label>
          <div className="relative">
            <input
              {...register("pipe_diameter", { valueAsNumber: true })}
              type="number"
              step={isUS ? "0.001" : "1"}
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              {diamUnit}
            </span>
          </div>
          {errors.pipe_diameter && (
            <p className={errCls}>{errors.pipe_diameter.message}</p>
          )}
        </div>
      </div>

      {/* Material */}
      <div>
        <label className={labelCls}>Pipe Material / Roughness</label>
        <select {...register("material")} className={inputCls}>
          {materials.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        {errors.material && <p className={errCls}>{errors.material.message}</p>}
      </div>

      {/* Accessories picker */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={labelCls + " mb-0"}>Fittings &amp; Accessories</label>
          {pickedKSum > 0 && (
            <span className="text-xs font-mono text-teal-700 font-semibold">
              ΣK = {pickedKSum.toFixed(2)}
            </span>
          )}
        </div>
        <AccessoriesPicker onChange={handlePickerChange} />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Calculating…" : "Calculate TDH"}
      </button>
    </form>
  );
}
