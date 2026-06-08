/**
 * Internal helper.
 * Figures out who the current user is and what role they have
 * on the merch spreadsheet: 'editor' | 'viewer' | 'none'.
 */
function userAccessInfo_() {
  const ss = SpreadsheetApp.getActive();
  const user = Session.getActiveUser();
  const email = user ? user.getEmail() : "";

  if (!email) {
    return { email: "", role: "none", canEdit: false };
  }

  const editorEmails = ss.getEditors().map((u) => u.getEmail());
  const viewerEmails = ss.getViewers().map((u) => u.getEmail());

  if (editorEmails.includes(email)) {
    logMessage("editor role, can access and edit");
    return { email, role: "editor", canEdit: true };
  }
  if (viewerEmails.includes(email)) {
    logMessage("view role, can access but not edit");
    return { email, role: "viewer", canEdit: false };
  }

  // Not shared on the sheet at all
  return { email, role: "none", canEdit: false };
}

/**
 * Called by the frontend on load.
 * Throws ACCESS_DENIED if user does not have sheet access at all.
 */
// function getInitialAdminData() {
//   const access = userAccessInfo_();

//   if (access.role === 'none') {
//     logMessage('no role, no access')
//     throw new Error('ACCESS_DENIED');
//   }

//   const noteByRole = {
//     editor: 'You can edit and sync merch data.',
//     viewer: 'You can view merch data, but not change it via this tool.',
//   };

//   return {
//     userEmail: access.email,
//     role: access.role,
//     canEdit: access.canEdit,
//     note: noteByRole[access.role] || '',
//   };
// }

// function assertCanEdit_() {
//   const access = userAccessInfo_(); // from auth.js
//   if (!access || !access.canEdit) {
//     throw new Error("ACCESS_DENIED_WRITE");
//   }
// }

// Back-compat shim: some endpoints may still call this name.
// function userHasSheetAccess() {
//   const access = userAccessInfo_();
//   // Choose the meaning you want:
//   // return !!(access && access.canView);  // if "access" means view is enough
//   return !!(access && access.canEdit);    // if "access" means editor required (recommended)
// }
