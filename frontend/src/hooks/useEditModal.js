import { useState } from 'react';

const useEditModal = () => {
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [editFormData, setEditFormData] = useState({});
    const [editFoto, setEditFoto] = useState([]);
    const [removedEvidenceIds, setRemovedEvidenceIds] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const openEditModal = (item) => {
        setEditingItem(item);
        setEditFormData(item);
        setEditFoto([]);
        setRemovedEvidenceIds([]);
        setShowEditModal(true);
    };

    const closeEditModal = () => {
        setShowEditModal(false);
        setEditingItem(null);
        setEditFormData({});
        setEditFoto([]);
        setRemovedEvidenceIds([]);
        setIsLoading(false);
    };

    return {
        showEditModal,
        setShowEditModal,
        editingItem,
        setEditingItem,
        editFormData,
        setEditFormData,
        editFoto,
        setEditFoto,
        removedEvidenceIds,
        setRemovedEvidenceIds,
        isLoading,
        setIsLoading,
        openEditModal,
        closeEditModal
    };
};

export default useEditModal;
