'use strict';

const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

const DESTINATION = 'sthubsystem-qa';
const SYSTEM_ALIAS = 'MRNE188';

async function callStatusService(path) {
  try {
    const response = await executeHttpRequest(
      { destinationName: DESTINATION },
      {
        method: 'GET',
        url: path
      }
    );
    return response?.data || null;
  } catch (error) {
    cds?.log?.warn?.('Marine status service call failed', {
      path,
      error: error?.message || error
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
    prItems
  };
}

function normalizeInvoiceStatusResponse(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const success = data?.success === true && items.length > 0;
  return {
    success,
    message: data?.message || '',
    items
  };
}

async function getPurchaseOrderStatus(purchaseOrder) {
  if (!purchaseOrder) {
    return { success: false, message: 'Purchase order missing', poItems: [], prItems: [] };
  }

  const url = `/ptp/prpo/getstatus?PurchaseOrder=${encodeURIComponent(
    purchaseOrder
  )}&ISystemAlias=${SYSTEM_ALIAS}`;
  const data = await callStatusService(url);
  return normalizePoPrStatusResponse(data);
}

async function getInvoiceStatus(purchaseOrder) {
  if (!purchaseOrder) {
    return { success: false, message: 'Purchase order missing', items: [] };
  }

  const url = `/ptp/invoicestatus?PurchaseOrder=${encodeURIComponent(
    purchaseOrder
  )}&ISystemAlias=${SYSTEM_ALIAS}`;
  const data = await callStatusService(url);
  return normalizeInvoiceStatusResponse(data);
}

async function getPurchaseRequisitionStatus(purchaseRequisition) {
  if (!purchaseRequisition) {
    return { success: false, message: 'Purchase requisition missing', poItems: [], prItems: [] };
  }

  const url = `/ptp/prpo/getstatus?PurchaseRequisition=${encodeURIComponent(
    purchaseRequisition
  )}&ISystemAlias=${SYSTEM_ALIAS}`;
  const data = await callStatusService(url);
  return normalizePoPrStatusResponse(data);
}

module.exports = {
  getPurchaseOrderStatus,
  getInvoiceStatus,
  getPurchaseRequisitionStatus
};
