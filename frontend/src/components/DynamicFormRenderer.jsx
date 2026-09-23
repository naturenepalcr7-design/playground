'use client';

import { useState, useCallback } from 'react';
import {
  Type, Hash, ChevronDown, List, Camera, Calendar,
  CheckSquare, FileText, Save, X, AlertCircle, Loader2,
  Plus, Trash2, Tag, CheckCircle2, Link2
} from 'lucide-react';

/**
 * DynamicFormRenderer Component — Official Nepal Government WebGIS Standard
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 * Field Attribute Collection & Survey Form
 */

const FIELD_ICONS = {
  text: Type,
  number: Hash,
  select: ChevronDown,
  multiselect: List,
  date: Calendar,
  textarea: FileText,
  file: Camera,
  checkbox: CheckSquare,
};

export default function DynamicFormRenderer({
  schema, // { fields: [{ name, label, type, required, options, condition, ...}] }
  initialValues = {},
  onSubmit,
  onCancel,
  loading = false,
  title = 'विशेषता तथा तथ्याङ्क प्रविष्टि (Feature Attributes)',
  hideCustomFields = false,
}) {
  // Strip internal system metadata keys only
  const cleanInitial = { ...(initialValues || {}) };
  delete cleanInitial._version;
  delete cleanInitial._created_by;
  delete cleanInitial._updated_by;
  delete cleanInitial.geom;
  delete cleanInitial.the_geom;
  delete cleanInitial.geometry_type;

  const [values, setValues] = useState(cleanInitial);
  const [errors, setErrors] = useState({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [customVal, setCustomVal] = useState('');
  const [showAddCustom, setShowAddCustom] = useState(false);

  const schemaFields = schema?.fields || [];
  const schemaFieldNames = new Set(schemaFields.map((f) => f.name));

  // Find dynamic keys in values that are not in schema
  const dynamicKeys = hideCustomFields ? [] : Object.keys(values).filter((k) => !schemaFieldNames.has(k));

  // ---- Update field value ----
  const updateField = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  // ---- Remove dynamic field ----
  const removeField = useCallback((name) => {
    setValues((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  // ---- Add custom attribute field ----
  const handleAddCustomField = (e) => {
    e.preventDefault();
    const key = customKey.trim().replace(/\s+/g, '_');
    if (!key) return;
    updateField(key, customVal);
    setCustomKey('');
    setCustomVal('');
    setShowAddCustom(false);
  };

  // ---- Check conditional visibility for schema fields ----
  const isFieldVisible = useCallback((field) => {
    if (!field.condition) return true;
    const { field: condField, value: condValue, operator = 'equals' } = field.condition;
    const currentValue = values[condField];

    switch (operator) {
      case 'equals': return currentValue === condValue;
      case 'not_equals': return currentValue !== condValue;
      case 'in': return Array.isArray(condValue) && condValue.includes(currentValue);
      case 'not_empty': return !!currentValue;
      default: return true;
    }
  }, [values]);

  // ---- Validate ----
  const validate = useCallback(() => {
    const newErrors = {};
    schemaFields.forEach((field) => {
      if (!isFieldVisible(field)) return;
      if (field.required) {
        const val = values[field.name];
        const isEmpty =
          val === undefined ||
          val === null ||
          (typeof val === 'string' && val.trim() === '') ||
          (Array.isArray(val) && val.length === 0);
        if (isEmpty) {
          newErrors[field.name] = `${field.label || field.name} अनिवार्य छ (Required)`;
        }
      }
      if (field.type === 'number' && values[field.name] !== undefined && values[field.name] !== '') {
        const num = Number(values[field.name]);
        if (isNaN(num)) newErrors[field.name] = 'कृपया सही संख्या प्रविष्ट गर्नुहोस्';
        if (field.min !== undefined && num < field.min) newErrors[field.name] = `न्यूनतम मान: ${field.min}`;
        if (field.max !== undefined && num > field.max) newErrors[field.name] = `अधिकतम मान: ${field.max}`;
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [schemaFields, values, isFieldVisible]);

  // ---- Submit ----
  const handleSubmit = (e) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (!validate()) {
      const missingFields = schemaFields.filter((f) => f.required && (
        values[f.name] === undefined ||
        values[f.name] === null ||
        (typeof values[f.name] === 'string' && values[f.name].trim() === '') ||
        (Array.isArray(values[f.name]) && values[f.name].length === 0)
      ));
      const missingLabels = missingFields.map((f) => (f.label ? `${f.label} (${f.name})` : f.name));

      const msg = missingLabels.length > 0
        ? `⚠️ कृपया सबै अनिवार्य फिल्डहरू तुरुन्त भर्नुहोस्!\n(Please fill all compulsory fields instantly):\n\n• ${missingLabels.join('\n• ')}`
        : '⚠️ कृपया सबै अनिवार्य फिल्डहरू तुरुन्त भर्नुहोस्!';

      alert(msg);

      if (missingFields[0]) {
        setTimeout(() => {
          const el = document.querySelector(`[name="${missingFields[0].name}"]`) || document.getElementById(`field-${missingFields[0].name}`);
          if (el) el.focus();
        }, 50);
      }
      return;
    }

    const submitValues = { ...values };
    // Remove hidden conditional schema fields
    schemaFields.forEach((field) => {
      if (!isFieldVisible(field)) {
        delete submitValues[field.name];
      }
    });

    onSubmit(submitValues);
  };

  // ---- Render a schema field ----
  const renderSchemaField = (field) => {
    if (!isFieldVisible(field)) return null;

    const Icon = FIELD_ICONS[field.type] || Type;
    const error = errors[field.name];
    const value = values[field.name] ?? '';

    return (
      <div key={field.name} className="animate-fade-in">
        <label className="gov-label flex items-center justify-between gap-1.5 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="font-semibold text-slate-800 truncate">{field.label || field.name}</span>
            {field.required && <span className="text-gov-red-700 font-bold ml-0.5">*</span>}
          </div>
          {field.required && (
            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-50 text-rose-700 border border-rose-200 shrink-0 font-nepali">
              अनिवार्य (Required)
            </span>
          )}
        </label>

        {field.type === 'text' && (
          <input
            type="text"
            id={`field-${field.name}`}
            name={field.name}
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            className={`gov-input ${error ? 'border-gov-red-700 ring-1 ring-gov-red-700' : ''}`}
            placeholder={field.placeholder || ''}
            maxLength={field.maxLength || 500}
          />
        )}

        {field.type === 'number' && (
          <input
            type="number"
            id={`field-${field.name}`}
            name={field.name}
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            className={`gov-input ${error ? 'border-gov-red-700 ring-1 ring-gov-red-700' : ''}`}
            placeholder={field.placeholder || ''}
            min={field.min}
            max={field.max}
            step={field.step || 'any'}
          />
        )}

        {field.type === 'select' && (
          <select
            id={`field-${field.name}`}
            name={field.name}
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            className={`gov-input ${error ? 'border-gov-red-700 ring-1 ring-gov-red-700' : ''}`}
          >
            <option value="">— छान्नुहोस् (Select) —</option>
            {(field.options || []).map((opt) => (
              <option key={typeof opt === 'object' ? opt.value : opt}
                      value={typeof opt === 'object' ? opt.value : opt}>
                {typeof opt === 'object' ? opt.label : opt}
              </option>
            ))}
          </select>
        )}

        {field.type === 'multiselect' && (
          <div className="space-y-1 bg-slate-50 p-2 rounded border border-slate-200">
            {(field.options || []).map((opt) => {
              const optVal = typeof opt === 'object' ? opt.value : opt;
              const optLabel = typeof opt === 'object' ? opt.label : opt;
              const checked = Array.isArray(value) && value.includes(optVal);

              return (
                <label key={optVal} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-200/60 cursor-pointer text-xs text-slate-800">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const arr = Array.isArray(value) ? [...value] : [];
                      if (checked) updateField(field.name, arr.filter((v) => v !== optVal));
                      else updateField(field.name, [...arr, optVal]);
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-gov-blue-800 focus:ring-gov-blue-800"
                  />
                  {optLabel}
                </label>
              );
            })}
          </div>
        )}

        {field.type === 'date' && (
          <input
            type="date"
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            className={`gov-input ${error ? 'border-gov-red-700 ring-1 ring-gov-red-700' : ''}`}
          />
        )}

        {field.type === 'textarea' && (
          <textarea
            value={value}
            onChange={(e) => updateField(field.name, e.target.value)}
            className={`gov-input min-h-[70px] resize-y ${error ? 'border-gov-red-700 ring-1 ring-gov-red-700' : ''}`}
            placeholder={field.placeholder || ''}
            maxLength={field.maxLength || 2000}
            rows={3}
          />
        )}

        {field.type === 'checkbox' && (
          <label className="flex items-center gap-2 mt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => updateField(field.name, e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-gov-blue-800 focus:ring-gov-blue-800"
            />
            <span className="text-xs font-semibold text-slate-800">{field.checkboxLabel || 'हो / स्वीकार गर्दछु (Yes)'}</span>
          </label>
        )}

        {field.type === 'file' && (
          <div className="mt-1">
            <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-slate-300 rounded-md cursor-pointer hover:border-gov-blue-800 hover:bg-gov-blue-50/50 transition-all text-xs text-slate-600 bg-slate-50">
              <Camera className="w-4 h-4 text-gov-blue-800" />
              <span>{value ? (typeof value === 'string' ? value : 'फोटो चयन गरियो') : 'फोटो खिच्नुहोस् वा चयन गर्नुहोस् (Capture Photo)'}</span>
              <input
                type="file"
                accept={field.accept || 'image/*'}
                capture={field.capture || 'environment'}
                onChange={(e) => updateField(field.name, e.target.files[0])}
                className="hidden"
              />
            </label>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-1 mt-1 text-gov-red-700 text-xs font-medium">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {field.help && (
          <p className="text-[10px] text-slate-500 mt-0.5">{field.help}</p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5" id="dynamic-form">
      {/* Title Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <h3 className="text-xs font-bold text-gov-blue-900 flex items-center gap-1.5 font-nepali">
          <FileText className="w-4 h-4 text-gov-blue-800" />
          <span>{title}</span>
        </h3>
        {onCancel && (
          <button type="button" onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Missing Compulsory Fields Alert Banner */}
      {hasAttemptedSubmit && Object.keys(errors).length > 0 && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs font-nepali flex items-start gap-2 animate-shake">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold text-rose-950">कृपया सबै अनिवार्य फिल्डहरू भर्नुहोस् (Missing Compulsory Fields)</div>
            <div className="text-[10.5px] text-rose-800 mt-0.5 leading-relaxed">
              तलका अनिवार्य विवरणहरू नभरी फिचर सुरक्षित गर्न सकिँदैन:
              <ul className="list-disc list-inside mt-1 space-y-0.5 font-medium">
                {Object.keys(errors).map((errKey) => {
                  const sf = schemaFields.find((f) => f.name === errKey);
                  return (
                    <li key={errKey} className="text-rose-900">
                      {sf?.label || errKey}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Empty Schema Notice */}
      {schemaFields.length === 0 && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 font-nepali text-center">
          यस तहका लागि कुनै विशेषता फिल्डहरू छैनन्। (No attribute fields defined for this layer.)
        </div>
      )}

      {/* 1. Schema Predefined Fields */}
      {schemaFields.map(renderSchemaField)}

      {/* 2. Dynamic Layer Attributes (Only shown if custom fields not hidden) */}
      {!hideCustomFields && dynamicKeys.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-200">
          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5 font-nepali">
            <Tag className="w-3.5 h-3.5 text-gov-blue-800" />
            तहका विशेषताहरू (Layer Attributes)
          </div>
          {dynamicKeys.map((key) => {
            const isLinkedProp = key.endsWith('_linked_id') || key.endsWith('_id') || key.endsWith('_code') || key.endsWith('_no') || key.includes('id');
            const linkedLayerLabel = key.endsWith('_linked_id') ? key.replace(/_linked_id$/, '').replace(/_/g, ' ') : null;

            return (
              <div
                key={key}
                className={`p-2 rounded-lg border flex flex-col gap-1.5 transition-all ${
                  isLinkedProp
                    ? 'bg-purple-50/70 border-purple-300 ring-1 ring-purple-200 shadow-2xs'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold font-mono truncate max-w-[80%] flex items-center gap-1 text-slate-700">
                    {isLinkedProp && (
                      <Link2 className="w-3 h-3 text-purple-700 shrink-0" />
                    )}
                    <span className={isLinkedProp ? 'text-purple-950 font-bold' : ''}>
                      {key}
                    </span>
                    {linkedLayerLabel && (
                      <span className="text-[8.5px] px-1.5 py-0.2 rounded bg-purple-200 text-purple-900 font-sans font-semibold">
                        तह: {linkedLayerLabel}
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(key)}
                    className="text-slate-400 hover:text-gov-red-700 p-0.5 rounded transition-colors"
                    title={isLinkedProp ? 'सम्बन्ध हटाउनुहोस् (Unlink)' : 'फिल्ड हटाउनुहोस्'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={values[key] ?? ''}
                  onChange={(e) => updateField(key, e.target.value)}
                  className={`gov-input py-1 text-xs ${
                    isLinkedProp ? 'border-purple-300 focus:border-purple-600 bg-white font-medium text-purple-950' : ''
                  }`}
                  placeholder={`Value for ${key}`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Add Custom Attribute Field (Only shown if custom fields not hidden) */}
      {!hideCustomFields && (
        showAddCustom ? (
          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2 animate-fade-in">
            <div className="text-xs font-bold text-slate-700">थप विशेषता प्रविष्टि (Add Custom Field)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder="नाम (उदा. ward_no)"
                className="gov-input py-1 text-xs"
              />
              <input
                type="text"
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                placeholder="मान (Value)"
                className="gov-input py-1 text-xs"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={handleAddCustomField}
                className="btn-gov-primary py-1 px-3 text-xs"
              >
                थप्नुहोस्
              </button>
              <button
                type="button"
                onClick={() => setShowAddCustom(false)}
                className="btn-gov-secondary py-1 px-3 text-xs"
              >
                रद्द
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddCustom(true)}
            className="flex items-center gap-1 text-xs font-bold text-gov-blue-800 hover:text-gov-blue-900 transition-colors py-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>थप विशेषता थप्नुहोस् (Add Custom Field)</span>
          </button>
        )
      )}

      {/* Submit / Cancel Actions */}
      <div className="flex flex-wrap sm:flex-nowrap gap-2 pt-2 border-t border-slate-200">
        <button
          type="submit"
          disabled={loading}
          className={`btn-gov-primary flex-1 text-xs font-bold py-2 flex items-center justify-center gap-2 ${
            loading ? 'opacity-80 cursor-wait' : ''
          }`}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{loading ? 'सुरक्षित हुँदैछ... (Saving...)' : 'तथ्याङ्क सुरक्षित गर्नुहोस् (Save)'}</span>
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={loading} className="btn-gov-secondary text-xs py-2">
            रद्द (Cancel)
          </button>
        )}
      </div>
    </form>
  );
}
