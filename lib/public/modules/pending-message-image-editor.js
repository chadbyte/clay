var MAX_IMAGES = 20;
var MAX_IMAGE_DATA = 25 * 1024 * 1024;
var MAX_TOTAL_BYTES = 32 * 1024 * 1024;
var IMAGE_TYPE_RE = /^image\/[a-z0-9.+-]{1,64}$/i;

export function imageSrc(image) {
  if (!image) return "";
  if (image.data && image.mediaType) return "data:" + image.mediaType + ";base64," + image.data;
  return "";
}

export function imageDraft(image) {
  return { mediaType: image.mediaType, data: image.data };
}

function focusElement(element) {
  if (!element) return;
  try { element.focus({ preventScroll: true }); }
  catch (e) { element.focus(); }
}

export function openImagePreview(src, alt) {
  if (!src) return;
  var trigger = document.activeElement;
  var backdrop = document.createElement("div");
  backdrop.className = "pending-message-image-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Image preview");
  var close = document.createElement("button");
  close.type = "button";
  close.className = "pending-message-image-close";
  close.textContent = "Close";
  var image = document.createElement("img");
  image.src = src;
  image.alt = alt || "Queued image preview";
  backdrop.appendChild(close);
  backdrop.appendChild(image);
  function dismiss() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (trigger && trigger.isConnected) focusElement(trigger);
  }
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;
    var focusable = backdrop.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      focusElement(last);
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      focusElement(first);
    }
  }
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", function (event) { if (event.target === backdrop) dismiss(); });
  document.body.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  focusElement(close);
}

function imageBytes(image) {
  return image && image.data ? Math.ceil(image.data.length * 0.75) : 0;
}

function validateFiles(files, currentImages, replaceIndex) {
  var count = currentImages.length + files.length - (replaceIndex == null ? 0 : 1);
  if (count > MAX_IMAGES) return "Too many image attachments";
  var total = 0;
  for (var i = 0; i < currentImages.length; i++) if (i !== replaceIndex) total += imageBytes(currentImages[i]);
  for (var j = 0; j < files.length; j++) {
    if (!IMAGE_TYPE_RE.test(files[j].type || "") || files[j].size > MAX_IMAGE_DATA) return "Invalid image attachment";
    total += files[j].size;
  }
  if (total > MAX_TOTAL_BYTES) return "Message payload is too large";
  return null;
}

export function chooseImages(id, replaceIndex, deps) {
  var edit = deps.getEdit();
  if (!edit || edit.id !== id || edit.pendingReads || (deps.isEditable && !deps.isEditable(id))) return;
  var capturedContext = deps.getContext();
  var capturedToken = edit.token;
  var input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = replaceIndex == null;
  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    var capturedEdit = deps.getEdit();
    if (!capturedEdit || capturedEdit.id !== id || capturedEdit.token !== capturedToken || !deps.sameContext(deps.getContext(), capturedContext) || (deps.isEditable && !deps.isEditable(id))) return;
    var validationError = validateFiles(files, capturedEdit.images || [], replaceIndex);
    if (validationError) {
      deps.setEdit({ error: validationError });
      return;
    }
    var capturedGeneration = capturedEdit.generation;
    var readCount = files.length;
    var startIndex = replaceIndex == null ? (capturedEdit.images || []).length : replaceIndex;
    var staged = [];
    var completed = 0;
    var failed = false;
    deps.setEdit({ pendingReads: readCount });
    files.forEach(function (file, fileIndex) {
      var reader = new FileReader();
      reader.onload = function () {
        var current = deps.getEdit();
        if (!current || current.id !== id || current.token !== capturedToken || current.generation < capturedGeneration || !deps.sameContext(deps.getContext(), capturedContext) || (deps.isEditable && !deps.isEditable(id))) return;
        staged[fileIndex] = { mediaType: file.type, data: String(reader.result).split(",")[1] || "" };
        completed++;
        if (completed === readCount) {
          if (failed) deps.setEdit({ pendingReads: 0, error: "Could not read image" });
          else {
            var next = (current.images || []).slice();
            for (var stagedIndex = 0; stagedIndex < staged.length; stagedIndex++) next[startIndex + stagedIndex] = staged[stagedIndex];
            deps.setEdit({ images: next, pendingReads: 0 });
          }
        } else deps.setEdit({ pendingReads: readCount - completed, error: failed ? "Could not read image" : "" });
      };
      reader.onerror = function () {
        var current = deps.getEdit();
        if (current && current.id === id && current.token === capturedToken && deps.sameContext(deps.getContext(), capturedContext) && (!deps.isEditable || deps.isEditable(id))) {
          failed = true;
          completed++;
          if (completed === readCount) deps.setEdit({ pendingReads: 0, error: "Could not read image" });
          else deps.setEdit({ pendingReads: readCount - completed, error: "Could not read image" });
        }
      };
      reader.readAsDataURL(file);
    });
  });
  input.click();
}
