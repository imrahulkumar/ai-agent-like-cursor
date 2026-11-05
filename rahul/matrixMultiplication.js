// Matrix multiplication in JavaScript
function multiplyMatrices(a, b) {
  const aRows = a.length;
  const aCols = a[0].length;
  const bRows = b.length;
  const bCols = b[0].length;

  if (aCols !== bRows) {
    throw new Error('Number of columns of the first matrix must equal number of rows of the second matrix.');
  }

  // Initialize result matrix with zeros
  const result = new Array(aRows);
  for (let i = 0; i < aRows; i++) {
    result[i] = new Array(bCols).fill(0);
  }

  // Perform multiplication
  for (let i = 0; i < aRows; i++) {
    for (let j = 0; j < bCols; j++) {
      for (let k = 0; k < aCols; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}

// Example usage:
const A = [
  [1, 2, 3],
  [4, 5, 6]
];
const B = [
  [7, 8],
  [9, 10],
  [11, 12]
];
console.log('Result:', multiplyMatrices(A, B));
