window.ISP_MESSAGES = {
  auth: {
    loginFailed: "Invalid username or password.",
    inactiveUser: "This account is disabled.",
    networkError: "Could not reach the server. Check your connection and Supabase settings.",
    sessionExpired: "Please sign in again."
  },
  customers: {
    saved: "Customer saved successfully.",
    deleted: "Customer removed.",
    deleteConfirm: "Delete this customer and related payment history cannot be undone. Continue?",
    loadError: "Failed to load customers.",
    validation:
      "Please fill all required fields (User ID, Name, Package, Expiry)."
  },
  payments: {
    saved: "Payment recorded successfully.",
    accrualSaved:
      "Recharge saved: monthly charge added to dues and package expiry extended by one month. No payment recorded.",
    noOutstandingDue: "This customer has no outstanding dues to collect.",
    invalidAmount: "Enter a valid payment amount greater than zero.",
    loadError: "Failed to load payments."
  },
  dues: {
    lineAdded: "Due line added.",
    lineRemoved: "Due line removed.",
    paymentDeleted: "Payment deleted."
  },
  packages: {
    saved: "Package saved.",
    deleted: "Package deleted.",
    deleteConfirm: "Delete this package? Customers still assigned may lose pricing context.",
    loadError: "Failed to load packages."
  },
  areas: {
    saved: "Area saved.",
    deleted: "Area removed.",
    deleteConfirm: "Delete this area? Sub-areas should be removed first.",
    loadError: "Failed to load areas."
  },
  discounts: {
    saved: "Discount rule saved.",
    deleted: "Discount rule removed.",
    loadError: "Failed to load discounts."
  },
  paymentMethods: {
    saved: "Payment method added.",
    deleted: "Payment method removed.",
    deleteConfirm: "Remove this payment method?",
    loadError: "Failed to load payment methods."
  },
  reports: {
    exported: "Report exported.",
    noData: "No rows for the selected filters.",
    rangeInvalid: "Choose a valid date range."
  },
  generic: {
    unexpected: "Something went wrong. Please try again.",
    copied: "Copied to clipboard.",
    pdfError: "Could not generate PDF. Try printing from the browser.",
    invoicePdfShared: "Invoice PDF ready to share.",
    invoicePdfClipboard:
      "Invoice PDF copied. In WhatsApp Web, paste (Ctrl+V) or use Attach → Document.",
    invoicePdfDownload: "Invoice PDF saved — attach it in WhatsApp from your Downloads folder.",
    invoicePdfError: "Could not create invoice PDF."
  }
};
