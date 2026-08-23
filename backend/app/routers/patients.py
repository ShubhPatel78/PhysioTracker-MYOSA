from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Patient
from app.schemas import PatientResponse, PatientUpdate
from app.auth import get_current_user

router = APIRouter(prefix="/api/patients", tags=["patients"])

def to_patient_response(patient: Patient) -> PatientResponse:
    doctor = patient.doctor
    return PatientResponse(
        id=patient.id,
        user_id=patient.user_id,
        doctor_id=patient.doctor_id,
        name=patient.name,
        age=patient.age,
        condition=patient.condition,
        has_baseline_data=patient.has_baseline_data,
        created_at=patient.created_at,
        doctor_name=doctor.name if doctor else None,
        doctor_code=doctor.doctor_code if doctor else None,
    )

@router.get("", response_model=list[PatientResponse])
def list_patients(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role == "doctor":
        patients = db.query(Patient).filter(Patient.doctor_id == current_user.id).all()
        return [to_patient_response(p) for p in patients]
    elif current_user.role == "patient":
        patient = db.query(Patient).filter(Patient.user_id == current_user.id).first()
        return [to_patient_response(patient)] if patient else []
    else:
        return []

@router.get("/by-user/{user_id}", response_model=PatientResponse)
def get_patient_by_user_id(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.user_id == user_id).first()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient profile not found")
    return to_patient_response(patient)

@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(
    patient_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return to_patient_response(patient)

@router.put("/{patient_id}", response_model=PatientResponse)
def update_patient(
    patient_id: int,
    updates: PatientUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    if updates.name is not None:
        patient.name = updates.name.strip()
    if updates.age is not None:
        patient.age = updates.age
    if updates.condition is not None:
        patient.condition = updates.condition.strip()
    if updates.has_baseline_data is not None:
        patient.has_baseline_data = updates.has_baseline_data

    db.commit()
    db.refresh(patient)
    return to_patient_response(patient)
