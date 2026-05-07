import { useEffect, useState } from "react";
import { useForm, useFieldArray, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { fetchMaterials, type CalculationRequest, type MaterialOption } from "../utils/api";

// Zod v4 schema — use z.number() + { valueAsNumber: true } on register
// so react-hook-form delivers a number directly; no coerce needed.
const schema = z.object({
  Q: z.number().positive("Flow must be > 0"),
  flowUnit: z.enum(["m3h", "ls"]),
  elev_us_m: z.number(),
  elev_ds_m: z.number(),
  pipe_length_m: z.number().positive("Length must be > 0"),
  pipe_diameter_mm: z.number().positive("Diameter must be > 0"),
  material: z.string().min(1, "Select a material"),
  K_values: z.array(z.object({ K: z.number().min(0, "K must be ≥ 0") })),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onSubmit: (req: CalculationRequest) => void;
  loading: boolean;
}

export default function CalculationForm({ onSubmit, loading }: Props) {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any, // @hookform/resolvers v5 + zod v4
    defaultValues: {
      Q: 36,
      flowUnit: "m3h",
      elev_us_m: 5.0,
      elev_ds_m: 28.5,
      pipe_length_m: 200,
      pipe_diameter_mm: 150,
      material: "ductile_iron",
      K_values: [{ K: 0.5 }, { K: 0.3 }, { K: 1.0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "K_values" });

  const watchedK = watch("K_values");
  const watchedUnit = watch("flowUnit");
  const kTotal = watchedK?.reduce((s, f) => s + (Number(f.K) || 0), 0) ?? 0;

  useEffect(() => {
    fetchMaterials().then(setMaterials).catch(console.error);
  }, []);

  const submit: SubmitHandler<FormValues> = (values) => {
    // Convert L/s → m³/h if needed before sending to backend
    const Q_m3h = values.flowUnit === "ls" ? values.Q * 3.6 : values.Q;
    onSubmit({
      Q_m3h,
      elev_us_m: values.elev_us_m,
      elev_ds_m: values.elev_ds_m,
      pipe_length_m: values.pipe_length_m,
      pipe_diameter_mm: values.pipe_diameter_mm,
      material: values.material,
      K_values: values.K_values.map((f) => f.K),
    });
  };

  const inputCls =
    "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
  const labelCls =
    "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";
  const errCls = "mt-0.5 text-xs text-red-600";

  const flowLabel = watchedUnit === "ls" ? "L/s" : "m³/h";

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-5">

      {/* Flow with unit toggle */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls + " mb-0"}>Design Flow Q</label>
          <div className="flex rounded overflow-hidden border border-slate-300 text-xs font-mono">
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
        {watchedUnit === "ls" && (
          <p className="mt-0.5 text-xs text-slate-400 font-mono">
            Converted: {((watch("Q") || 0) * 3.6).toFixed(2)} m³/h
          </p>
        )}
      </div>

      {/* Elevations */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Upstream Elevation</label>
          <div className="relative">
            <input
              {...register("elev_us_m", { valueAsNumber: true })}
              type="number"
              step="0.01"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              m
            </span>
          </div>
          {errors.elev_us_m && <p className={errCls}>{errors.elev_us_m.message}</p>}
        </div>
        <div>
          <label className={labelCls}>Downstream Elevation</label>
          <div className="relative">
            <input
              {...register("elev_ds_m", { valueAsNumber: true })}
              type="number"
              step="0.01"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              m
            </span>
          </div>
          {errors.elev_ds_m && <p className={errCls}>{errors.elev_ds_m.message}</p>}
        </div>
      </div>

      {/* Pipe geometry */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Pipe Length L</label>
          <div className="relative">
            <input
              {...register("pipe_length_m", { valueAsNumber: true })}
              type="number"
              step="1"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              m
            </span>
          </div>
          {errors.pipe_length_m && <p className={errCls}>{errors.pipe_length_m.message}</p>}
        </div>
        <div>
          <label className={labelCls}>Internal Diameter D</label>
          <div className="relative">
            <input
              {...register("pipe_diameter_mm", { valueAsNumber: true })}
              type="number"
              step="1"
              className={inputCls}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
              mm
            </span>
          </div>
          {errors.pipe_diameter_mm && (
            <p className={errCls}>{errors.pipe_diameter_mm.message}</p>
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

      {/* Minor-loss K values */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls + " mb-0"}>Minor Loss K Values</label>
          <span className="text-xs font-mono text-teal-700 font-semibold">
            ΣK = {kTotal.toFixed(2)}
          </span>
        </div>
        <div className="space-y-1.5">
          {fields.map((field, i) => (
            <div key={field.id} className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-5 text-right">{i + 1}.</span>
              <Controller
                control={control}
                name={`K_values.${i}.K`}
                render={({ field: f }) => (
                  <input
                    value={isNaN(f.value as number) ? "" : f.value}
                    onChange={(e) => f.onChange(e.target.valueAsNumber)}
                    onBlur={f.onBlur}
                    type="number"
                    step="0.05"
                    placeholder="e.g. 0.5"
                    className={inputCls + " flex-1"}
                  />
                )}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-slate-400 hover:text-red-500 transition-colors text-lg leading-none px-1"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => append({ K: 0 })}
          className="mt-2 text-xs text-teal-700 font-semibold hover:text-teal-900 transition-colors"
        >
          + Add fitting / valve
        </button>
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
