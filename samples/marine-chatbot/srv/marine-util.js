'use strict';

const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

const DESTINATION = 'sthubsystem-qa';
const SYSTEM_ALIAS = 'MRNE188';

async function callStatusService(path) {
  console.log('[MARINE] Calling status service', { destination: DESTINATION, url: path });

  try {
    const response = await executeHttpRequest(
      { destinationName: DESTINATION },
      {
        method: 'GET',
        url: path
      }
    );

    // Log status + small preview (avoid huge logs)
    const preview =
      typeof response?.data === 'string'
        ? response.data.slice(0, 500)
        : JSON.stringify(response?.data || {}).slice(0, 1000);

    console.log('[MARINE] Status service success', {
      httpStatus: response?.status,
      dataPreview: preview
    });

    return response?.data || null;
  } catch (error) {
    console.error('[MARINE] Status service FAILED', {
      destination: DESTINATION,
      url: path,
      message: error?.message,
      status: error?.response?.status,
      responseData: error?.response?.data
    });
    return null;
  }
}

function normalizePoPrStatusResponse(data) {
  const poItems = Array.isArray(data?.poItems) ? data.poItems : [];
  const prItems = Array.isArray(data?.prItems) ? data.prItems : [];

  const success = data?.success === true && (poItems.length > 0 || prItems.length > 0);

  return {
    success,
    message: data?.message || '',
    poItems,
    prItems,
    raw: data
  };
}

function normalizeInvoiceStatusResponse(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const success = data?.success === true && items.length > 0;

  return {
    success,
    message: data?.message || '',
    items,
    raw: data
  };
}

async function getPurchaseOrderStatus(purchaseOrder) {
  if (!purchaseOrder) {
    return { success: false, message: 'Purchase order missing', poItems: [], prItems: [], raw: null };
  }

  const url = `/ptp/prpo/getstatus?PurchaseOrder=${encodeURIComponent(purchaseOrder)}&ISystemAlias=${SYSTEM_ALIAS}`;
  const data = await callStatusService(url);

  if (!data) {
    return { success: false, message: 'No response from backend service', poItems: [], prItems: [], raw: null };
  }

  return normalizePoPrStatusResponse(data);
}

async function getInvoiceStatus(purchaseOrder) {
  if (!purchaseOrder) {
    return { success: false, message: 'Purchase order missing', items: [], raw: null };
  }

  const url = `/ptp/invoicestatus?PurchaseOrder=${encodeURIComponent(purchaseOrder)}&ISystemAlias=${SYSTEM_ALIAS}`;
  const data = await callStatusService(url);

  if (!data) {
    return { success: false, message: 'No response from backend service', items: [], raw: null };
  }

  return normalizeInvoiceStatusResponse(data);
}

async function getPurchaseRequisitionStatus(purchaseRequisition) {
  if (!purchaseRequisition) {
    return { success: false, message: 'Purchase requisition missing', poItems: [], prItems: [], raw: null };
  }

  const url = `/ptp/prpo/getstatus?PurchaseRequisition=${encodeURIComponent(purchaseRequisition)}&ISystemAlias=${SYSTEM_ALIAS}`;
  const data = await callStatusService(url);

  if (!data) {
    return { success: false, message: 'No response from backend service', poItems: [], prItems: [], raw: null };
  }

  return normalizePoPrStatusResponse(data);
}

module.exports = {
  getPurchaseOrderStatus,
  getInvoiceStatus,
  getPurchaseRequisitionStatus
};
