import { stripFileCiteMarkers } from "@/lib/chat/references"

export function formatReference(reference: string, isReferenceSection: boolean = false): string {
  // Extraer el número de referencia y el nombre del archivo
  const match = reference.match(/【(\d+):(\d+)(?:-(\d+))?(?:,(\d+):(\d+))?(?:,(\d+):(\d+))?\†(.+?)】$/);
  
  if (!match) {
    return reference; // Si no coincide con el formato esperado, devolver la referencia original
  }

  const [, number, startPage1, endPage1, startPage2, endPage2, filename] = match;
  
  if (isReferenceSection) {
    // En la sección de referencias, mostrar el formato completo con salto de línea
    return `[${number}] ${filename}, (páginas ${startPage1}-${endPage1 || startPage1})\n`;
  } else {
    // En el texto, mostrar solo el número
    return `[${number}]`;
  }
}

export function formatReferences(text: string): string {
  // Buscar todas las referencias en el texto
  const referenceRegex = /【\d+:\d+(?:-\d+)?(?:,\d+:\d+)?(?:,\d+:\d+)?\†.+?】/g;
  
  // Reemplazar cada referencia encontrada
  let formattedText = stripFileCiteMarkers(text);
  
  // Primero, reemplazar las referencias en el texto principal
  formattedText = formattedText.replace(referenceRegex, (match) => formatReference(match, false));
  
  // Luego, reemplazar las referencias en la sección de referencias
  formattedText = formattedText.replace(/Referencias:[\s\S]*?(?=\n\n|$)/g, (match) => {
    // Agregar un salto de línea después de "Referencias:"
    let formattedMatch = match.replace(/Referencias:/, 'Referencias:\n');
    // Reemplazar las referencias y agregar salto de línea
    return formattedMatch.replace(referenceRegex, (ref) => formatReference(ref, true));
  });
  
  // Finalmente, asegurarse de que no queden referencias sin formatear
  formattedText = formattedText.replace(referenceRegex, (match) => formatReference(match, false));
  
  return formattedText;
} 