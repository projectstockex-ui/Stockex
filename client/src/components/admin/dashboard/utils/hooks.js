/**
 * Custom hooks for AdminDashboard
 */
import { useState, useMemo, useEffect } from 'react';

/**
 * Custom hook for pagination with global search
 * @param {array} data - Data array to paginate
 * @param {number} itemsPerPage - Number of items per page
 * @param {string} searchTerm - Search term for filtering
 * @param {array} searchFields - Array of field names to search in
 * @returns {object} Pagination state and data
 */
export const usePagination = (data, itemsPerPage = 20, searchTerm = '', searchFields = []) => {
  const [currentPage, setCurrentPage] = useState(1);

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;

    const term = searchTerm.toLowerCase();
    return data.filter(item => 
      searchFields.some(field => {
        const value = field.split('.').reduce((obj, key) => obj?.[key], item);
        return value?.toString().toLowerCase().includes(term);
      })
    );
  }, [data, searchTerm, searchFields]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(start, start + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  return {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedData,
    filteredData,
    totalItems: filteredData.length
  };
};
